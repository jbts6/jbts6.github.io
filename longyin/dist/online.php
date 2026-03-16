<?php

// 配置
define('ONLINE_TIMEOUT', 300);
define('DATA_FILE', __DIR__ . '/online_data.json');
define('BACKUP_FILE', __DIR__ . '/online_data_backup.json');
define('LOCK_FILE', __DIR__ . '/online_data.lock');
define('MAX_BACKUP_AGE', 3600);

// 版本配置
const CURRENT_VERSION = "v1.0.0f6.531";
const CURRENT_VERSION_TIMESTAMP = 1773642000;

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST');
header('Access-Control-Allow-Headers: Content-Type');

function getClientId() {
    $cookieName = 'online_client_id';
    
    if (isset($_COOKIE[$cookieName])) {
        $clientId = $_COOKIE[$cookieName];
        if (preg_match('/^[a-f0-9]{32}$/i', $clientId)) {
            return $clientId;
        }
    }
    
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    $random = bin2hex(random_bytes(8));
    $clientId = md5($random . time() . $ip);
    
    setcookie($cookieName, $clientId, time() + 86400, '/', '', false, true);
    
    return $clientId;
}

function acquireLock() {
    $lockFile = fopen(LOCK_FILE, 'c');
    if (!$lockFile) {
        return false;
    }
    
    $startTime = microtime(true);
    while (!flock($lockFile, LOCK_EX)) {
        if (microtime(true) - $startTime > 3) {
            fclose($lockFile);
            return false;
        }
        usleep(100000);
    }
    
    return $lockFile;
}

function releaseLock($lockFile) {
    if ($lockFile) {
        flock($lockFile, LOCK_UN);
        fclose($lockFile);
    }
}

function readData() {
    if (!file_exists(DATA_FILE)) {
        return ['users' => [], 'total_visits' => 0, 'last_cleanup' => time()];
    }
    
    $content = file_get_contents(DATA_FILE);
    if ($content === false) {
        if (file_exists(BACKUP_FILE)) {
            $content = file_get_contents(BACKUP_FILE);
            if ($content !== false) {
                $data = json_decode($content, true);
                if ($data) return $data;
            }
        }
        return ['users' => [], 'total_visits' => 0, 'last_cleanup' => time()];
    }
    
    $data = json_decode($content, true);
    if (!$data) {
        if (file_exists(BACKUP_FILE)) {
            $backupContent = file_get_contents(BACKUP_FILE);
            if ($backupContent !== false) {
                $data = json_decode($backupContent, true);
                if ($data) return $data;
            }
        }
        return ['users' => [], 'total_visits' => 0, 'last_cleanup' => time()];
    }
    
    return $data;
}

function writeData($data) {
    $dir = dirname(DATA_FILE);
    if (!is_dir($dir)) {
        mkdir($dir, 0755, true);
    }
    
    $tempFile = DATA_FILE . '.tmp.' . getmypid();
    $jsonContent = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
    
    if (file_put_contents($tempFile, $jsonContent) === false) {
        @unlink($tempFile);
        return false;
    }
    
    if (!rename($tempFile, DATA_FILE)) {
        @unlink($tempFile);
        return false;
    }
    
    $lastBackup = $data['last_backup'] ?? 0;
    if (time() - $lastBackup > MAX_BACKUP_AGE) {
        @copy(DATA_FILE, BACKUP_FILE);
    }
    
    return true;
}

function cleanExpiredUsers(&$users) {
    $now = time();
    $expired = [];
    
    foreach ($users as $id => $info) {
        if (!isset($info['last_active'])) {
            $expired[] = $id;
            continue;
        }
        if ($now - $info['last_active'] > ONLINE_TIMEOUT) {
            $expired[] = $id;
        }
    }
    
    foreach ($expired as $id) {
        unset($users[$id]);
    }
    
    return count($expired);
}

function getClientIP() {
    $ip = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? $_SERVER['REMOTE_ADDR'] ?? 'unknown';
    if (strpos($ip, ',') !== false) {
        $ips = explode(',', $ip);
        $ip = trim($ips[0]);
    }
    return $ip;
}

$action = $_GET['action'] ?? 'status';
$clientVersion = $_GET['version'] ?? '';
$clientTimestamp = $_GET['timestamp'] ?? 0;
$clientId = getClientId();
$now = time();

// 版本验证
$versionValid = ($clientVersion === CURRENT_VERSION);
$timestampValid = ($clientTimestamp >= CURRENT_VERSION_TIMESTAMP);

$lockFile = acquireLock();
if (!$lockFile) {
    $data = readData();
    echo json_encode([
        'success' => true,
        'online_count' => count($data['users'] ?? []),
        'total_visits' => $data['total_visits'] ?? 0,
        'timestamp' => $now,
        'readonly' => true,
        'version_check' => [
            'current_version' => CURRENT_VERSION,
            'current_timestamp' => CURRENT_VERSION_TIMESTAMP,
            'client_version' => $clientVersion,
            'client_timestamp' => $clientTimestamp,
            'version_valid' => $versionValid,
            'timestamp_valid' => $timestampValid
        ]
    ]);
    exit;
}

try {
    $data = readData();
    
    if (!isset($data['users'])) $data['users'] = [];
    if (!isset($data['total_visits'])) $data['total_visits'] = 0;
    
    $users = &$data['users'];
    
    $lastCleanup = $data['last_cleanup'] ?? 0;
    if ($now - $lastCleanup > 300) {
        cleanExpiredUsers($users);
        $data['last_cleanup'] = $now;
    }
    
    switch ($action) {
        case 'heartbeat':
            if (!$versionValid || !$timestampValid) {
                echo json_encode([
                    'success' => false,
                    'error' => 'version_outdated',
                    'message' => '请刷新页面使用最新版本',
                    'version_check' => [
                        'current_version' => CURRENT_VERSION,
                        'current_timestamp' => CURRENT_VERSION_TIMESTAMP,
                        'client_version' => $clientVersion,
                        'client_timestamp' => $clientTimestamp
                    ]
                ]);
                break;
            }
            
            if (!isset($users[$clientId])) {
                $users[$clientId] = [
                    'first_seen' => $now,
                    'last_active' => $now,
                    'ip' => getClientIP(),
                    'version' => $clientVersion
                ];
                $data['total_visits']++;
            } else {
                $users[$clientId]['last_active'] = $now;
                $users[$clientId]['version'] = $clientVersion;
            }
            writeData($data);
            
            echo json_encode([
                'success' => true,
                'online_count' => count($users),
                'total_visits' => $data['total_visits'],
                'version_check' => [
                    'current_version' => CURRENT_VERSION,
                    'current_timestamp' => CURRENT_VERSION_TIMESTAMP
                ]
            ]);
            break;
            
        case 'leave':
            if (isset($users[$clientId])) {
                unset($users[$clientId]);
                writeData($data);
            }
            echo json_encode(['success' => true]);
            break;
            
        case 'status':
        default:
            echo json_encode([
                'success' => true,
                'online_count' => count($users),
                'total_visits' => $data['total_visits'],
                'timestamp' => $now,
                'version_check' => [
                    'current_version' => CURRENT_VERSION,
                    'current_timestamp' => CURRENT_VERSION_TIMESTAMP,
                    'client_version' => $clientVersion,
                    'client_timestamp' => $clientTimestamp,
                    'version_valid' => $versionValid,
                    'timestamp_valid' => $timestampValid
                ]
            ]);
            break;
    }
} finally {
    releaseLock($lockFile);
}
