# S3 Desktop · Windows x64

[English](README.en.md)

用本机 AWS CLI 管理 S3 的桌面程序。支持浏览、拖入上传、批量下载、预览、复制、剪切、重命名和 CloudFront 签名。

## 下载与使用

从 Releases 下载 EXE 并双击运行。缺少 AWS CLI v2 时，可在应用中一键安装到当前用户。

验证 AWS 凭证并输入桶名后即可进入资源页。勾选「记住凭证」会保存到 AWS 的标准凭证文件，并记住上次成功打开的桶。CloudFront 公钥 ID 和 PEM 只用于签名。

- [下载此平台发布包](https://github.com/Aban-gh/s3-desktop-windows/releases)
- [本平台 AWS CLI 命令](docs/AWS-CLI.zh-CN.md)

## 其他平台与互跳

- [Windows x64](https://github.com/Aban-gh/s3-desktop-windows/blob/main/README.md) · [发布包](https://github.com/Aban-gh/s3-desktop-windows/releases)
- [macOS Apple Silicon (arm64)](https://github.com/Aban-gh/s3-desktop-mac-arm64/blob/main/README.md) · [发布包](https://github.com/Aban-gh/s3-desktop-mac-arm64/releases)
- [macOS Intel](https://github.com/Aban-gh/s3-desktop-mac-intel/blob/main/README.md) · [发布包](https://github.com/Aban-gh/s3-desktop-mac-intel/releases)

## 本地开发与二开

使用 Node.js 22 或更高版本。源码允许按许可证做非商业二开和分发。第三方组件仍使用各自许可证。

```powershell
npm ci
npm start
npm run build
```

开发者 [GuiHui Wu（Aban-gh）](https://github.com/Aban-gh)。 [非商业许可证](LICENSE) · [版权声明](NOTICE)
