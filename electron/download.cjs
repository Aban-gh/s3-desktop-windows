const fs = require('node:fs/promises');
const { COPYFILE_EXCL } = require('node:fs').constants;
const path = require('node:path');
const { execute } = require('./aws.cjs');

function localName(name) {
  const reserved = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]) *(\.|$)/i;
  const invalid = !name || name === '.' || name === '..' || /[/\x00-\x1f]/.test(name);
  const windowsInvalid = process.platform === 'win32' && (/[<>:"\\|?*]|[ .]$/.test(name) || reserved.test(name));
  if (invalid || windowsInvalid || (process.platform === 'darwin' && name.includes(':'))) {
    throw Error('当前系统无法使用此文件名：' + JSON.stringify(name));
  }
  return name;
}

function folderEntries(key, objects) {
  const names = new Map();
  return objects.map(object => {
    if (!object.Key.startsWith(key)) throw Error('对象不在所选目录中');
    const relative = object.Key.slice(key.length);
    const folder = object.Key.endsWith('/') && Number(object.Size) === 0;
    if (!relative && folder) return { folder, parts: [] };
    const parts = (folder ? relative.slice(0, -1) : relative).split('/').map(localName);
    for (let i = 1; i <= parts.length; i++) {
      const name = parts.slice(0, i).join('/');
      const isFolder = folder || i < parts.length;
      const pathKey = name.normalize('NFC').toLowerCase();
      const existing = names.get(pathKey);
      if (existing && (existing.name !== name || existing.isFolder !== isFolder)) {
        throw Error('目录中有本地文件系统无法区分的同名路径：' + name);
      }
      names.set(pathKey, { name, isFolder });
    }
    return { folder, parts, key: object.Key };
  });
}

async function exists(target) {
  try { await fs.lstat(target); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function publish(stage, root, name, folder) {
  const ext = folder ? '' : path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let index = 0; ; index++) {
    const target = path.join(root, index ? `${stem} (${index})${ext}` : name);
    if (await exists(target)) continue;
    try {
      if (!folder) await fs.copyFile(stage, target, COPYFILE_EXCL);
      else if (process.platform === 'win32') await fs.rename(stage, target);
      else {
        // POSIX rename can replace an empty directory. Reserve the name first.
        await fs.mkdir(target);
        try { await fs.rename(stage, target); }
        catch (error) { await fs.rmdir(target).catch(() => {}); throw error; }
      }
      return target;
    } catch (error) {
      if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes(error.code) || !(await exists(target))) throw error;
    }
  }
}

async function downloadToFolder(data) {
  const folder = data.folder === true;
  if (!data.key || folder !== data.key.endsWith('/')) throw Error('下载对象路径无效');
  const name = localName((folder ? data.key.slice(0, -1) : data.key).split('/').pop());
  const root = await fs.realpath(data.root);
  const entries = folder ? folderEntries(data.key, JSON.parse(await execute('scan', { ...data, limit:false })).Contents || []) : [];
  if (folder && !entries.length) throw Error('该目录已不存在');
  const temp = await fs.mkdtemp(path.join(root, '.s3-download-'));
  const stage = path.join(temp, 'data');
  try {
    if (folder) {
      await fs.mkdir(stage);
      for (const item of entries) {
        const destination = path.join(stage, ...item.parts);
        await fs.mkdir(item.folder ? destination : path.dirname(destination), { recursive:true });
        if (!item.folder) await execute('get', { ...data, key:item.key, destination });
      }
    } else {
      await execute('get', { ...data, destination:stage });
    }
    return await publish(stage, root, name, folder);
  } finally {
    await fs.rm(temp, { recursive:true, force:true, maxRetries:2 }).catch(() => {});
  }
}

module.exports = { downloadToFolder };
