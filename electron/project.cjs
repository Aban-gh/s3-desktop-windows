const { app } = require('electron');

function projectInfo() {
  const variant = process.platform === 'win32' ? 'windows'
    : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'mac-arm64' : 'mac-intel') : '';
  return {
    version:app.getVersion(),
    developer:'GuiHui Wu (Aban-gh)',
    developerUrl:'https://github.com/Aban-gh',
    repositoryUrl:variant ? 'https://github.com/Aban-gh/s3-desktop-' + variant : '',
    licenseUrl:'https://polyformproject.org/licenses/noncommercial/1.0.0'
  };
}

module.exports = { projectInfo };
