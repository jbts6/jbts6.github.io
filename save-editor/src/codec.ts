import { ExtData, decode as msgpackDecode, encode as msgpackEncode } from "@msgpack/msgpack";
import pako from "pako";

const MAGIC = [0x93, 0xc1, 0x4a, 0x2e, 0x02] as const;
const BASE64_CHUNK_RE = /[A-Za-z0-9+/=\r\n]{32,}/g;

export type SaveKind = "config" | "v2";

export interface SaveTextParts {
  prefix: string;
  payload: string;
  suffix: string;
}

export interface DecodedSave {
  value: unknown;
  kind: SaveKind;
  saveId: number | null;
  parts: SaveTextParts;
  payloadLength: number;
  msgpackLength: number;
}

function normalizeBase64(value: string): string {
  return value.replace(/\s+/g, "");
}

function isBase64Text(value: string): boolean {
  return value.length > 0 && /^[A-Za-z0-9+/=]+$/.test(value);
}

export function extractSavePayload(raw: string): SaveTextParts {
  const compact = normalizeBase64(raw.trim());
  if (compact.length >= 32 && isBase64Text(compact)) {
    return { prefix: "", payload: compact, suffix: "" };
  }

  const candidates = Array.from(raw.matchAll(BASE64_CHUNK_RE));
  let best: RegExpMatchArray | null = null;
  let bestLength = 0;

  for (const candidate of candidates) {
    const segment = normalizeBase64(candidate[0]);
    if (!segment || !isBase64Text(segment)) continue;
    if (segment.length > bestLength) {
      best = candidate;
      bestLength = segment.length;
    }
  }

  if (!best || best.index == null) {
    throw new Error("未找到有效的 base64 存档内容。");
  }

  return {
    prefix: raw.slice(0, best.index),
    payload: normalizeBase64(best[0]),
    suffix: raw.slice(best.index + best[0].length)
  };
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function utf8Bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
  const bytes = typeof data === "string" ? utf8Bytes(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)));
}

function saveSeed(saveId: number): string {
  if (saveId === 0) {
    return "dq2|sv2|tk_expand|RPGMV|MV|global|0";
  }
  return `dq2|sv2|tk_expand|RPGMV|MV|save|${saveId}`;
}

async function deriveSaveKeys(saveId: number): Promise<{ encKey: Uint8Array; macKey: Uint8Array }> {
  const base = hex(await sha256(saveSeed(saveId)));
  return {
    encKey: await sha256(`${base}|enc|`),
    macKey: await sha256(`${base}|mac|`)
  };
}

async function aesCbcDecrypt(keyBytes: Uint8Array, iv: Uint8Array, ciphertext: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-CBC", false, ["decrypt"]);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: toArrayBuffer(iv) }, key, toArrayBuffer(ciphertext)));
}

async function aesCbcEncrypt(keyBytes: Uint8Array, iv: Uint8Array, plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), "AES-CBC", false, ["encrypt"]);
  return new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: toArrayBuffer(iv) }, key, toArrayBuffer(plaintext)));
}

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(keyBytes), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, toArrayBuffer(data)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

function isV2Save(raw: Uint8Array): boolean {
  return MAGIC.every((byte, index) => raw[index] === byte);
}

function inferSaveId(fileName: string): number | null {
  const lower = fileName.toLowerCase();
  if (lower === "global.rpgsave" || lower === "global") return 0;
  const match = lower.match(/^file(\d+)(?:\.rpgsave)?$/);
  if (!match) return null;
  return Number(match[1]);
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function writeUInt32LE(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = (value >>> 8) & 0xff;
  bytes[offset + 2] = (value >>> 16) & 0xff;
  bytes[offset + 3] = (value >>> 24) & 0xff;
}

async function unpackV2(raw: Uint8Array, saveId: number): Promise<Uint8Array> {
  if (raw.length < 57 || !isV2Save(raw)) {
    throw new Error("不是支持的 v2 存档。");
  }

  const iv = raw.subarray(5, 21);
  const ciphertextLength = readUInt32LE(raw, 21);
  const ciphertextStart = 25;
  const ciphertextEnd = ciphertextStart + ciphertextLength;
  if (ciphertextEnd + 32 > raw.length) {
    throw new Error("v2 存档长度不完整。");
  }

  const ciphertext = raw.subarray(ciphertextStart, ciphertextEnd);
  const mac = raw.subarray(ciphertextEnd, ciphertextEnd + 32);
  const keys = await deriveSaveKeys(saveId);
  const actualMac = await hmacSha256(keys.macKey, raw.subarray(0, ciphertextEnd));
  if (!sameBytes(mac, actualMac)) {
    throw new Error("存档 HMAC 校验失败，槽位 ID 可能不正确。");
  }

  const compressed = await aesCbcDecrypt(keys.encKey, iv, ciphertext);
  return pako.inflate(compressed);
}

async function packV2(saveId: number, msgpackBytes: Uint8Array): Promise<string> {
  const keys = await deriveSaveKeys(saveId);
  const compressed = pako.deflate(msgpackBytes, { level: 9 });
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const ciphertext = await aesCbcEncrypt(keys.encKey, iv, compressed);
  const header = new Uint8Array(25);
  header.set(MAGIC, 0);
  header.set(iv, 5);
  writeUInt32LE(header, 21, ciphertext.length);
  const authenticated = concatBytes([header, ciphertext]);
  const mac = await hmacSha256(keys.macKey, authenticated);
  return bytesToBase64(concatBytes([authenticated, mac]));
}

export async function decodeSaveText(raw: string, fileName: string, requestedSaveId?: number | null): Promise<DecodedSave> {
  const parts = extractSavePayload(raw);
  const payload = base64ToBytes(parts.payload);
  const saveId = requestedSaveId ?? inferSaveId(fileName);

  if (isV2Save(payload)) {
    if (saveId == null || !Number.isFinite(saveId)) {
      throw new Error("v2 存档需要正确的槽位 ID，例如 global=0、file1=1。");
    }
    const msgpackBytes = await unpackV2(payload, saveId);
    return {
      value: msgpackDecode(msgpackBytes),
      kind: "v2",
      saveId,
      parts,
      payloadLength: parts.payload.length,
      msgpackLength: msgpackBytes.length
    };
  }

  const msgpackBytes = pako.inflate(payload);
  return {
    value: msgpackDecode(msgpackBytes),
    kind: "config",
    saveId: null,
    parts,
    payloadLength: parts.payload.length,
    msgpackLength: msgpackBytes.length
  };
}

export async function encodeSaveText(
  value: unknown,
  kind: SaveKind,
  saveId: number | null,
  parts?: SaveTextParts | null
): Promise<string> {
  const msgpackBytes = msgpackEncode(value);
  const payload = kind === "v2"
    ? await packV2(Number(saveId), msgpackBytes)
    : bytesToBase64(pako.deflate(msgpackBytes, { level: 9 }));
  if (!parts) return payload;
  return `${parts.prefix}${payload}${parts.suffix}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function toJsonFriendly(value: unknown): unknown {
  if (typeof value === "bigint") return { $bigint: value.toString() };
  if (value instanceof Uint8Array) return { $binary: bytesToBase64(value) };
  if (value instanceof ExtData) {
    const dataValue = typeof value.data === "function" ? value.data(0) : value.data;
    return { $ext: { type: value.type, data: bytesToBase64(dataValue) } };
  }
  if (value instanceof Map) {
    return { $map: Array.from(value.entries()).map(([key, val]) => [toJsonFriendly(key), toJsonFriendly(val)]) };
  }
  if (Array.isArray(value)) return value.map((item) => toJsonFriendly(item));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = toJsonFriendly(val);
    return out;
  }
  return value;
}

export function fromJsonFriendly(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => fromJsonFriendly(item));

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === "$binary") {
      if (typeof value.$binary !== "string") throw new Error("$binary 必须是 base64 字符串。");
      return base64ToBytes(value.$binary);
    }
    if (keys.length === 1 && keys[0] === "$bigint") {
      if (typeof value.$bigint !== "string") throw new Error("$bigint 必须是十进制字符串。");
      return BigInt(value.$bigint);
    }
    if (keys.length === 1 && keys[0] === "$ext") {
      const extObj = value.$ext;
      if (!isPlainObject(extObj)) throw new Error("$ext 必须是对象。");
      if (typeof extObj.type !== "number") throw new Error("$ext.type 必须是数字。");
      if (typeof extObj.data !== "string") throw new Error("$ext.data 必须是 base64 字符串。");
      return new ExtData(extObj.type, base64ToBytes(extObj.data));
    }
    if (keys.length === 1 && keys[0] === "$map") {
      if (!Array.isArray(value.$map)) throw new Error("$map 必须是 [key, value] 数组。");
      const map = new Map<unknown, unknown>();
      for (const pair of value.$map) {
        if (!Array.isArray(pair) || pair.length !== 2) throw new Error("$map 条目必须是 [key, value]。");
        map.set(fromJsonFriendly(pair[0]), fromJsonFriendly(pair[1]));
      }
      return map;
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) out[key] = fromJsonFriendly(val);
    return out;
  }

  return value;
}
