# S3 Desktop · Windows x64

[简体中文](README.md)

A desktop client for S3 that uses your local AWS CLI. Browse, drag in uploads, download batches, preview media, copy, move, rename, and generate CloudFront signed URLs.

## Download and use

Download the portable EXE from Releases and run it. If AWS CLI v2 is missing, the app can install the official package for the current Windows user.

Verify your AWS credentials and enter a bucket name. Remembering credentials writes them to the standard AWS credentials file and remembers the last successfully opened bucket. The CloudFront public key ID and PEM are needed only for signing.

- [Download this platform’s release](https://github.com/Aban-gh/s3-desktop-windows/releases)
- [AWS CLI commands for this platform](docs/AWS-CLI.en.md)

## Platform repositories

- [Windows x64](https://github.com/Aban-gh/s3-desktop-windows/blob/main/README.en.md) · [Releases](https://github.com/Aban-gh/s3-desktop-windows/releases)
- [macOS Apple Silicon (arm64)](https://github.com/Aban-gh/s3-desktop-mac-arm64/blob/main/README.en.md) · [Releases](https://github.com/Aban-gh/s3-desktop-mac-arm64/releases)
- [macOS Intel](https://github.com/Aban-gh/s3-desktop-mac-intel/blob/main/README.en.md) · [Releases](https://github.com/Aban-gh/s3-desktop-mac-intel/releases)

## Develop and customize

Use Node.js 22 or later. The license allows noncommercial changes and redistribution. Third-party components retain their own licenses.

```powershell
npm ci
npm start
npm run build
```

Developer [GuiHui Wu (Aban-gh)](https://github.com/Aban-gh). [Noncommercial license](LICENSE) · [Copyright notices](NOTICE)
