const { spawn } = require('node:child_process');
const path = require('node:path');
const { awsExecutable } = require('./cli-setup.cjs');

function command(action, data) {
  if (action === 'identity') return ['sts', 'get-caller-identity', '--output', 'json', '--cli-connect-timeout', '8', '--cli-read-timeout', '10'];
  const bucket = data.bucket.trim();
  if (!bucket || /[\s/]/.test(bucket)) throw Error('请填写正确的存储桶名称');
  const uri = 's3://' + bucket + '/';
  switch (action) {
    case 'scan':
      return ['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix=' + data.key,
        '--output', 'json', ...(data.limit ? ['--max-keys', '1', '--no-paginate'] : [])];
    case 'mkdir':
    case 'folder-marker':
      return ['s3api', 'put-object', '--bucket', bucket, '--key=' + data.key, '--if-none-match', '*'];
    case 'delete':
      return ['s3api', 'delete-object', '--bucket', bucket, '--key=' + data.key,
        ...(data.etag ? ['--if-match', data.etag] : [])];
    case 'head':
      return ['s3api', 'head-object', '--bucket', bucket, '--key=' + data.key, '--output', 'json'];
    case 'bucket-region':
      return ['s3api', 'head-bucket', '--bucket', bucket, '--query', 'BucketRegion', '--output', 'text',
        '--cli-connect-timeout', '4', '--cli-read-timeout', '4'];
    case 'copy':
      return ['s3api', 'copy-object', '--bucket', data.targetBucket || bucket, '--key=' + data.destination,
        '--copy-source', bucket + '/' + data.key.split('/').map(encodeURIComponent).join('/'),
        '--copy-source-if-match', data.etag, '--if-none-match', '*', '--output', 'json'];
    case 'preview':
    case 'get':
      return ['s3api', 'get-object', '--bucket', bucket, '--key=' + data.key, data.destination];
    case 'list': {
      const args = ['s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', data.prefix,
        '--delimiter', '/', '--max-keys', '200', '--no-paginate', '--output', 'json'];
      if (data.token) args.push('--continuation-token', data.token);
      return args;
    }
    case 'upload':
      return ['s3', 'cp', data.file, uri + data.prefix + path.basename(data.file), '--no-progress'];
    case 'upload-tree':
      return ['s3', 'cp', data.file, uri + data.prefix, '--recursive', '--no-follow-symlinks', '--no-progress'];
    case 'download':
      return ['s3', 'cp', uri + data.key, data.destination, '--no-progress'];
    case 'sign': {
      if (!data.privateKey || !data.keyId) throw Error('请在设置中选择 PEM 私钥并填写公钥 ID');
      if (!Number.isSafeInteger(data.seconds) || data.seconds < 1) throw Error('有效期必须是正整数秒');
      const base = new URL(data.cdn);
      if (base.protocol !== 'https:' || base.search || base.hash) throw Error('请输入 HTTPS CDN 基础地址');
      const key = data.key.split('/').map(encodeURIComponent).join('/');
      return ['cloudfront', 'sign', '--url', base.href.replace(/\/$/, '') + '/' + key,
        '--key-pair-id', data.keyId, '--private-key', 'file://' + data.privateKey,
        '--date-less-than', String(Math.floor(Date.now() / 1000) + data.seconds)];
    }
    default: throw Error('未知操作');
  }
}

async function entries(data) {
  if (!data.key || (data.folder && !data.key.endsWith('/'))) throw Error('目标路径无效');
  if (data.folder) return JSON.parse(await execute('scan', data)).Contents || [];
  const meta = JSON.parse(await execute('head', data));
  return [{ Key: data.key, ETag: meta.ETag, Size: meta.ContentLength }];
}

async function copyOrMove(data, moving, label) {
  const targetBucket = data.targetBucket || data.bucket;
  if (!data.key || !data.destination || data.key.endsWith('/') !== data.destination.endsWith('/')) {
    throw Error('源路径或目标路径无效');
  }
  if (targetBucket === data.bucket &&
    (data.destination === data.key || (data.folder && data.destination.startsWith(data.key)))) {
    throw Error('不能粘贴到原位置或源目录的子目录');
  }
  const objects = await entries(data);
  if (!objects.length) throw Error('源目录为空或已不存在');
  if (objects.some(object => object.Size > 5_000_000_000)) throw Error('此操作仅支持不超过 5 GB 的单个对象');
  if (objects.some(object => !object.ETag || (data.folder && !object.Key.startsWith(data.key)))) {
    throw Error('无法确认源对象版本，请刷新后再试');
  }
  if (data.folder) {
    const target = JSON.parse(await execute('scan', { ...data, bucket:targetBucket, key:data.destination, limit:true }));
    if (target.KeyCount) throw Error('目标目录已存在');
  }
  let copied = 0, deleted = 0;
  try {
    for (const object of objects) {
      await execute('copy', { ...data, targetBucket, key:object.Key, etag:object.ETag,
        destination:data.destination + object.Key.slice(data.key.length) });
      copied++;
    }
    if (moving) {
      for (const object of objects) {
        await execute('delete', { ...data, key:object.Key, etag:object.ETag });
        deleted++;
      }
    }
  } catch (error) {
    const reason = /PreconditionFailed/i.test(error.message) ? '目标已存在或源对象发生变化。' : error.message;
    const deletion = moving ? `，已移除源对象 ${deleted}/${objects.length}` : '';
    throw Error(`${label}未完成：已复制 ${copied}/${objects.length}${deletion}。\n${reason}`);
  }
  return '';
}

async function execute(action, data) {
  if (action === 'direct-url') {
    if (!/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(data.bucket)) throw Error('存储桶名称无效');
    const region = await execute('bucket-region', data).catch(() => '');
    const domain = region.startsWith('cn-') ? 'amazonaws.com.cn' : 'amazonaws.com';
    const endpoint = /^[a-z]{2}(-[a-z0-9]+)+-\d+$/.test(region) ? 's3.' + region : 's3';
    const key = data.key.split('/').map(encodeURIComponent).join('/');
    return data.bucket.includes('.') ? `https://${endpoint}.${domain}/${data.bucket}/${key}`
      : `https://${data.bucket}.${endpoint}.${domain}/${key}`;
  }
  if (action === 'rename') return copyOrMove(data, true, '重命名');
  if (action === 'paste') return copyOrMove(data, data.cut === true, data.cut ? '移动' : '复制');
  if (action === 'targets') return JSON.stringify(await entries(data));
  if (action === 'mkdir' && JSON.parse(await execute('scan', { ...data, limit: true })).KeyCount) {
    throw Error('该目录已存在');
  }
  const args = command(action, data);
  if (data.profile && !data.auth) args.push('--profile', data.profile);
  const env = { ...process.env, AWS_PAGER: '', AWS_CLI_AUTO_PROMPT: 'off',
    AWS_CLI_OUTPUT_ENCODING: 'UTF-8', AWS_CLI_FILE_ENCODING: 'UTF-8' };
  if (data.auth) {
    delete env.AWS_PROFILE;
    delete env.AWS_DEFAULT_PROFILE;
    delete env.AWS_SESSION_TOKEN;
    delete env.AWS_SECURITY_TOKEN;
    env.AWS_ACCESS_KEY_ID = data.auth.id;
    env.AWS_SECRET_ACCESS_KEY = data.auth.secret;
    if (!env.AWS_REGION && !env.AWS_DEFAULT_REGION && action === 'identity') env.AWS_DEFAULT_REGION = 'us-east-1';
  }
  if (process.platform === 'darwin') {
    // Finder launches with a shorter PATH than an interactive shell.
    env.PATH = [env.PATH, '/usr/local/bin', '/opt/homebrew/bin', '/usr/local/aws-cli', '/usr/bin', '/bin']
      .filter(Boolean).join(path.delimiter);
  }
  if (data.proxy) {
    env.HTTP_PROXY = env.HTTPS_PROXY = data.proxy;
    if (process.platform !== 'win32') env.http_proxy = env.https_proxy = data.proxy;
  }
  return new Promise((resolve, reject) => {
    const child = spawn(awsExecutable(), args, { env, windowsHide: true, shell: false });
    let output = '', error = '';
    child.stdout.setEncoding('utf8').on('data', chunk => { output += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { error += chunk; });
    child.on('error', error => reject(error.code === 'ENOENT'
      ? Error('找不到 AWS CLI。请安装 AWS CLI v2，并在终端运行 aws --version 确认。')
      : error));
    child.on('close', code => code === 0 ? resolve(output.trim()) : reject(Error(error.trim() || 'AWS CLI 退出码 ' + code)));
  });
}
module.exports = { command, execute };
