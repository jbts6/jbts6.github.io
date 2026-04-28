import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ConfigProvider, theme } from "antd";
import "antd/dist/reset.css";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          // 主色：更深一点，且配合深色文字，提升 darkmode 下“主色按钮/Badge”可读性
          colorPrimary: "#41f3b4",
          colorInfo: "#41f3b4",
          colorPrimaryHover: "#63ffd0",
          // Primary/solid 背景上的文字颜色（默认是白色，浅青底会发灰看不清）
          colorTextLightSolid: "#06110f",
          borderRadius: 12,
          colorBgBase: "#0b0d14",
        },
      }}
    >
      <App />
    </ConfigProvider>
  </React.StrictMode>,
);
