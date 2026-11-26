const { contextBridge, ipcRenderer, webUtils } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  windows: process.platform === 'win32',
  setTheme: theme => ipcRenderer.invoke('theme:set', theme),
  choose: (kind, name) => ipcRenderer.invoke('choose', kind, name),
  copy: value => ipcRenderer.invoke('copy', value),
  filePath: file => webUtils.getPathForFile(file),
  inspectUpload: files => ipcRenderer.invoke('upload:inspect', files),
  preview: data => ipcRenderer.invoke('preview:load', data),
  releasePreview: url => ipcRenderer.invoke('preview:release', url),
  detectCli: () => ipcRenderer.invoke('setup:detect'),
  installCli: () => ipcRenderer.invoke('setup:install'),
  openMacInstaller: () => ipcRenderer.invoke('setup:mac-download'),
  projectInfo: () => ipcRenderer.invoke('project:info'),
  openProjectLink: key => ipcRenderer.invoke('project:open', key),
  cliProgress: callback => {
    const listener = (_, value) => callback(value);
    ipcRenderer.on('setup:progress', listener);
    return () => ipcRenderer.removeListener('setup:progress', listener);
  },
  restore: proxy => ipcRenderer.invoke('setup:restore', proxy),
  signIn: data => ipcRenderer.invoke('setup:signin', data),
  signOut: () => ipcRenderer.invoke('setup:signout'),
  run: (action, data) => ipcRenderer.invoke('run', action, data)
});
