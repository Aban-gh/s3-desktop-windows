const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createWriteStream } = require('node:fs');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const run = promisify(execFile);
const installer = 'https://awscli.amazonaws.com/AWSCLIV2-User.msi';
let executable = 'aws';
let installing;

async function detectCli() {
  const locations = process.platform === 'darwin'
    ? ['/usr/local/bin/aws', '/opt/homebrew/bin/aws', '/usr/local/aws-cli/aws', 'aws']
    : [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Amazon', 'AWSCLIV2', 'aws.exe'),
      ...[process.env.ProgramW6432, process.env.ProgramFiles].filter(Boolean)
        .map(base => path.join(base, 'Amazon', 'AWSCLIV2', 'aws.exe')), 'aws'];
  for (const candidate of new Set(locations.filter(Boolean))) {
    try {
      const { stdout, stderr } = await run(candidate, ['--version'], { windowsHide:true, timeout:5000 });
      const match = (stdout + stderr).match(/\baws-cli\/(2\.[\d.]+)/);
      if (match) {
        executable = candidate;
        return { installed:true, version:match[1] };
      }
    } catch {}
  }
  return { installed:false };
}

async function installCli(net, report) {
  if (process.platform !== 'win32') throw Error('一键安装仅在 Windows 上提供');
  if (installing) return installing;
  installing = (async () => {
    const status = await detectCli();
    if (status.installed) return status;
    const temp = await fs.mkdtemp(path.join(os.tmpdir(), 's3-desktop-cli-'));
    const file = path.join(temp, 'AWSCLIV2-User.msi');
    const system = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    try {
      report('正在下载 AWS 官方安装包…');
      const response = await net.fetch(installer, { redirect:'error', signal:AbortSignal.timeout(600000) });
      if (!response.ok || !response.body) throw Error('下载失败（HTTP ' + response.status + '）');
      await pipeline(Readable.fromWeb(response.body), createWriteStream(file, { flags:'wx' }));
      report('正在验证安装包签名…');
      const verify = '$s=Get-AuthenticodeSignature -LiteralPath $env:S3_DESKTOP_MSI; ' +
        'if ($s.Status -ne "Valid") { exit 1 }; $s.SignerCertificate.Subject';
      try {
        const { stdout } = await run(path.join(system, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
          ['-NoProfile', '-NonInteractive', '-Command', verify], {
            windowsHide:true, env:{ ...process.env, S3_DESKTOP_MSI:file }, timeout:60000
          });
        if (!/(?:^|,\s*)O=(?:"(?:Amazon Web Services, Inc\.|Amazon\.com Services LLC|Amazon\.com, Inc\.)"|Amazon\.com Services LLC)(?:,|\s*$)/i.test(stdout)) {
          throw Error('Unexpected installer publisher');
        }
      } catch { throw Error('AWS 安装包的发布者或数字签名无法验证'); }
      report('正在为当前 Windows 用户安装 AWS CLI…');
      try { await run(path.join(system, 'msiexec.exe'), ['/i', file, '/qn', '/norestart'], { windowsHide:true }); }
      catch (error) {
        if (+error.code === 3010 || +error.code === 1641) {
          const result = await detectCli();
          if (!result.installed) throw Error('安装完成，请重新启动 Windows 后重试');
          return result;
        }
        throw Error('AWS CLI 安装失败（Windows Installer 代码 ' + error.code + '）');
      }
      const result = await detectCli();
      if (!result.installed) throw Error('安装后未找到 AWS CLI v2，请点击重新检测');
      return result;
    } finally { await fs.rm(temp, { recursive:true, force:true, maxRetries:3 }).catch(() => {}); }
  })();
  try { return await installing; } finally { installing = undefined; }
}

module.exports = { detectCli, installCli, awsExecutable: () => executable };
