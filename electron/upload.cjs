const fs = require('node:fs/promises');
const path = require('node:path');
const { execute } = require('./aws.cjs');

async function inspect(file) {
  if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('无法读取拖入项目的本地路径');
  if (!path.basename(file)) throw Error('请选择具体的文件或目录');
  const stat = await fs.lstat(file);
  if (!stat.isFile() && !stat.isDirectory()) throw Error('无法上传此类型的项目：' + path.basename(file));
  return { file, folder:stat.isDirectory() };
}

async function emptyDirectories(directory, prefix) {
  const children = await fs.readdir(directory, { withFileTypes:true });
  const entries = children.filter(child => child.isDirectory() || child.isFile());
  if (!entries.length) return [prefix];
  const markers = [];
  for (const child of entries) {
    if (child.isDirectory()) markers.push(...await emptyDirectories(path.join(directory, child.name), prefix + child.name + '/'));
  }
  return markers;
}

async function uploadItem(data) {
  const item = await inspect(data.file);
  if (item.folder !== data.folder) throw Error('项目类型发生变化，请重新选择后再上传');
  if (!item.folder) return execute('upload', data);
  const prefix = data.prefix + path.basename(data.file) + '/';
  const markers = await emptyDirectories(data.file, prefix);
  await execute('upload-tree', { ...data, prefix });
  for (const key of markers) {
    try { await execute('folder-marker', { ...data, key }); }
    catch (error) { if (!/PreconditionFailed/i.test(error.message)) throw error; }
  }
  return '';
}

module.exports = { inspect, uploadItem };
