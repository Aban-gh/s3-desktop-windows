const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { execute } = require('./aws.cjs');

const profile = 's3-desktop-managed';
const marker = '# Managed by S3 Desktop';
let active;

function credentialsPath() {
  return process.env.AWS_SHARED_CREDENTIALS_FILE || path.join(os.homedir(), '.aws', 'credentials');
}

async function readFile(file) {
  try { return await fs.readFile(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

function locate(content) {
  const sections = [...content.matchAll(/^[ \t]*\[([^\]\r\n]+)\][ \t]*(?:[#;][^\r\n]*)?\r?$/gm)];
  const index = sections.findIndex(section => section[1].trim() === profile);
  if (index === -1) return null;
  const start = sections[index].index;
  const end = sections[index + 1]?.index ?? content.length;
  return { start, end, body:content.slice(start, end) };
}

function parse(section) {
  if (!section?.body.split(/\r?\n/).includes(marker)) return;
  const field = key => new RegExp('^' + key + '[ \\t]*=[ \\t]*([^\\r\\n]+)', 'm').exec(section.body)?.[1].trim();
  const id = field('aws_access_key_id');
  const secret = field('aws_secret_access_key');
  if (id && secret) return { id, secret };
}

async function remember(value) {
  const file = credentialsPath();
  const content = await readFile(file);
  const section = locate(content);
  if (section && !section.body.split(/\r?\n/).includes(marker)) {
    if (!value) return;
    throw Error('同名 AWS Profile 已存在，无法保存。可取消勾选「记住凭证」后继续。');
  }
  if (!section && !value) return;
  const base = section ? content.slice(0, section.start) + content.slice(section.end) : content;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const separator = base && !base.endsWith('\n') ? eol : '';
  const block = value ? [`[${profile}]`, marker, 'aws_access_key_id = ' + value.id,
    'aws_secret_access_key = ' + value.secret, ''].join(eol) : '';
  await fs.mkdir(path.dirname(file), { recursive:true, mode:0o700 });
  const temporary = path.join(path.dirname(file), '.s3-desktop-' + randomUUID());
  try {
    await fs.writeFile(temporary, base + (block ? separator + block : ''), { mode:0o600, flag:'wx' });
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force:true }).catch(() => {}); }
}

function mask(value) { return value.id.slice(0, 4) + '••••' + value.id.slice(-4); }

function sessionInfo(value, remembered) {
  return {
    masked:mask(value),
    remembered,
    bucketScope:remembered ? createHash('sha256').update(value.id).digest('hex') : null
  };
}

async function signIn(value, keep, proxy) {
  if (!/^[A-Z0-9]{16,128}$/.test(value.id) || !/^[A-Za-z0-9/+=]{16,256}$/.test(value.secret)) {
    throw Error('请检查 Access Key ID 和 Secret Access Key 的格式');
  }
  if (value.id.startsWith('ASIA')) throw Error('这是临时访问密钥，还需要 Session Token。当前表单仅支持长期访问密钥。');
  await execute('identity', { auth:value, proxy });
  await remember(keep ? value : null);
  active = value;
  return sessionInfo(value, keep);
}

async function restore(proxy) {
  const value = parse(locate(await readFile(credentialsPath())));
  if (!value) return null;
  await execute('identity', { auth:value, proxy });
  active = value;
  return sessionInfo(value, true);
}

async function signOut() {
  await remember(null);
  active = undefined;
}

module.exports = { signIn, restore, signOut, current:() => active };
