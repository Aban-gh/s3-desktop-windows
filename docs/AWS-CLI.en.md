# AWS CLI commands · Windows x64

[简体中文](AWS-CLI.zh-CN.md) · [Project home](../README.en.md)

These commands are for Windows x64. Replace the sample bucket, paths, and public key ID. Run each example separately. AWS credentials come from your CLI profile or your application session.

## Set up AWS CLI v2

[AWS official installation guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

```powershell
aws --version
aws configure --profile my-s3
$env:AWS_PROFILE = 'my-s3'
$env:HTTPS_PROXY = 'http://127.0.0.1:8801' # optional
```

## Browse, upload, and download

```powershell
aws s3 ls 's3://my-example-bucket/'
aws s3 ls 's3://my-example-bucket/media/'
aws s3 ls 's3://my-example-bucket/media/' --recursive --human-readable --summarize
aws s3 cp "$HOME\Desktop\example.zip" 's3://my-example-bucket/media/'
aws s3 cp 's3://my-example-bucket/media/example.zip' "$HOME\Downloads\example.zip"
aws s3 cp 's3://my-example-bucket/media/' "$HOME\Downloads\media" --recursive
```

## CloudFront signing (600 seconds)

```powershell
$expires = [DateTimeOffset]::UtcNow.AddSeconds(600).ToUnixTimeSeconds()
$pem = (Resolve-Path "$HOME\Desktop\cloudfront-private.pem").Path
aws cloudfront sign --url 'https://cdn.example.com/media/example.zip' --key-pair-id 'YOUR_PUBLIC_KEY_ID' --private-key "file://$pem" --date-less-than $expires
```

From Finder, set the proxy separately in the app’s settings if needed. Keep the private PEM file local.
