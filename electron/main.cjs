const { app, BrowserWindow, ipcMain, dialog, clipboard, net, nativeTheme, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execute } = require('./aws.cjs');
const { downloadToFolder } = require('./download.cjs');
const { inspect, uploadItem } = require('./upload.cjs');
const { detectCli, installCli } = require('./cli-setup.cjs');
const credentials = require('./credentials.cjs');
const { projectInfo } = require('./project.cjs');
const windows = process.platform === 'win32';
const gated = windows || process.platform === 'darwin';
const previewFiles = new Map();
const titleBar = {
  light:{ color:'#e9edf6', symbolColor:'#172135', height:36 },
  dark:{ color:'#1d2029', symbolColor:'#eef3fc', height:36 }
};

async function removePreview(url) {
  const directory = previewFiles.get(url);
  if (!directory) return;
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 2 }).then(() => previewFiles.delete(url)).catch(() => {});
}


function createWindow() {
  const window = new BrowserWindow({
    width: 1220, height: 820, minWidth: 800, minHeight: 600, autoHideMenuBar: true,
    ...(windows ? {
      icon:path.join(__dirname, 'cloud-courier.ico'),
      titleBarStyle:'hidden',
      titleBarOverlay:titleBar[nativeTheme.themeSource] || titleBar.light
    } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true }
  });
  if (windows) window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.loadFile(path.join(__dirname, '../dist/index.html'));
}
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow();
  });
});
app.on('window-all-closed', async () => {
  await Promise.all([...previewFiles.keys()].map(removePreview));
  if (process.platform !== 'darwin') app.quit();
});

function authorized(data) {
  const auth = credentials.current();
  if (gated && !auth) throw Error('请先验证 AWS 凭证');
  return { ...data, auth };
}

ipcMain.handle('setup:detect', async () => gated ? { gated, ...await detectCli() } : { gated, installed:true });
ipcMain.handle('setup:install', async event => installCli(net, value => {
  if (!event.sender.isDestroyed()) event.sender.send('setup:progress', value);
}));
ipcMain.handle('setup:mac-download', () => {
  if (process.platform === 'darwin') return shell.openExternal('https://awscli.amazonaws.com/AWSCLIV2.pkg');
});
ipcMain.handle('project:info', () => projectInfo());
ipcMain.handle('project:open', (_, key) => {
  if (!['developerUrl','repositoryUrl','licenseUrl'].includes(key)) return;
  const url = projectInfo()[key];
  if (url) return shell.openExternal(url);
});
ipcMain.handle('setup:restore', (_, proxy) => credentials.restore(proxy));
ipcMain.handle('setup:signin', (_, data) => credentials.signIn(
  { id:String(data.id || '').trim(), secret:String(data.secret || '').trim() }, data.remember === true, data.proxy));
ipcMain.handle('setup:signout', () => credentials.signOut());
ipcMain.handle('theme:set', (event, theme) => {
  if (theme !== 'dark' && theme !== 'light') return;
  nativeTheme.themeSource = theme;
  if (windows) BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay(titleBar[theme]);
});

ipcMain.handle('choose', async (event, kind, name) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  if (kind === 'destination') {
    const result = await dialog.showOpenDialog(parent, { title:'选择下载目录', properties:['openDirectory', 'createDirectory'] });
    return result.canceled ? '' : result.filePaths[0];
  }
  if (kind === 'save') {
    const invalid = process.platform === 'win32' ? /[<>:"|?*]/g : /:/g;
    const defaultPath = path.basename(name || 'download').replace(invalid, '_') || 'download';
    const result = await dialog.showSaveDialog(parent, { defaultPath });
    return result.canceled ? '' : result.filePath;
  }
  const many = kind === 'files';
  const result = await dialog.showOpenDialog(parent, {
    properties: many ? ['openFile', 'multiSelections'] : ['openFile'],
    filters: many ? [] : [{ name: 'CloudFront 私钥', extensions: ['pem', 'key'] }, {name:'所有文件', extensions:['*']}]
  });
  return many ? result.filePaths : result.filePaths[0] || '';
});
ipcMain.handle('copy', (_, value) => clipboard.writeText(String(value)));
ipcMain.handle('upload:inspect', async (_, files) => Promise.all(files.map(inspect)));
ipcMain.handle('preview:release', (_, url) => removePreview(url));
ipcMain.handle('preview:load', async (_, data) => {
  data = authorized(data);
  const extension = path.extname(data.key).toLowerCase();
  if (!/^\.(png|jpe?g|gif|webp|bmp|avif|ico|mp4|webm|m4v|mov|ogg|ogv)$/.test(extension)) throw Error('该格式暂不支持预览');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 's3-desktop-media-'));
  const destination = path.join(directory, 'media' + extension);
  const url = pathToFileURL(destination).href;
  previewFiles.set(url, directory);
  try {
    await execute('preview', { ...data, destination });
    return url;
  } catch (error) {
    await removePreview(url);
    throw error;
  }
});
ipcMain.handle('run', async (_, action, data) => {
  try {
    if (action === 'identity') throw Error('未知操作');
    const input = authorized(data);
    if (action === 'download-to-folder') return { ok:true, output:await downloadToFolder(input) };
    if (action === 'upload-item') return { ok:true, output:await uploadItem(input) };
    return { ok:true, output:await execute(action, input) };
  }
  catch (error) { return { ok: false, error: error.message }; }
});
