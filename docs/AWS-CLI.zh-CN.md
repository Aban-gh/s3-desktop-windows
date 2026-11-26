# AWS CLI 命令 · Windows x64

[English](AWS-CLI.en.md) · [项目首页](../README.md)

这些命令面向 Windows x64。将示例桶名、文件路径和公钥 ID 换成自己的配置。各示例按需运行。凭证由 AWS CLI Profile 或应用会话提供。

## 准备 AWS CLI v2

[AWS 官方安装指南](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

```powershell
aws --version
aws configure --profile my-s3
$env:AWS_PROFILE = 'my-s3'
$env:HTTPS_PROXY = 'http://127.0.0.1:8801' # optional
```

## 浏览、上传和下载

```powershell
aws s3 ls 's3://my-example-bucket/'
aws s3 ls 's3://my-example-bucket/media/'
aws s3 ls 's3://my-example-bucket/media/' --recursive --human-readable --summarize
aws s3 cp "$HOME\Desktop\example.zip" 's3://my-example-bucket/media/'
aws s3 cp 's3://my-example-bucket/media/example.zip' "$HOME\Downloads\example.zip"
aws s3 cp 's3://my-example-bucket/media/' "$HOME\Downloads\media" --recursive
```

## CloudFront 签名（600 秒）

```powershell
$expires = [DateTimeOffset]::UtcNow.AddSeconds(600).ToUnixTimeSeconds()
$pem = (Resolve-Path "$HOME\Desktop\cloudfront-private.pem").Path
aws cloudfront sign --url 'https://cdn.example.com/media/example.zip' --key-pair-id 'YOUR_PUBLIC_KEY_ID' --private-key "file://$pem" --date-less-than $expires
```

从 Finder 启动应用时，如需代理，请在应用设置中单独填写。私钥 PEM 只保留在本机。
