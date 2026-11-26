<script setup>
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import CredentialsForm from './CredentialsForm.vue'
import BucketForm from './BucketForm.vue'
import './style.css'

const api = window.desktop
const defaults = { bucket: '', prefix: '', profile: '', proxy: '', cdn: '', keyId: '', privateKey: '', seconds: 600 }
let saved = {}
try { saved = JSON.parse(localStorage.getItem('config') || '{}') } catch {}
const { bucketSettings: savedBuckets, ...savedSettings } = saved
const settings = reactive({ ...defaults, ...savedSettings })
const bucketSettings = savedBuckets || {}
const profileKey = (profile, bucket) => JSON.stringify([profile, bucket])
bucketSettings[profileKey(settings.profile, settings.bucket)] ??= {
  cdn:settings.cdn, keyId:settings.keyId, privateKey:settings.privateKey, seconds:settings.seconds
}
const draft = reactive({})
const tab = ref('objects'), modal = ref(''), folder = ref(settings.prefix || '')
const theme = ref(localStorage.getItem('theme') === 'dark' ? 'dark' : 'light')
const startup = ref('checking'), session = ref(null), gated = ref(true)
const setupBusy = ref(false), setupError = ref(''), installStatus = ref('')
const bucketError = ref(''), suggestedBucket = ref('')
const rememberedBucketKey = 'rememberedBucket'
const transferOpen = ref(false), transferTab = ref('upload')
const blocked = computed(() => startup.value !== 'ready')
const rows = ref([]), token = ref(''), query = ref(''), order = ref('name')
const busy = ref(false), sending = ref(false), loaded = ref(false), notice = ref(''), failure = ref('')
const pending = ref([]), jobs = ref([]), link = ref(''), linkKey = ref(''), jump = ref('')
const tips = ref([]), dragOver = ref(false)
const objectClipboard = ref(null)
const project = ref(null)
let tipId = 0
const tipTimers = new Map()
const downloadJobs = ref([]), downloadRoot = ref('')
let downloadSource
const selected = ref([]), nameInput = ref(''), renameItem = ref(null), deletePlan = ref([])
const signedLink = ref(false), mediaList = ref([]), mediaIndex = ref(0), mediaUrl = ref(''), mediaError = ref(''), mediaLoading = ref(false)
const currentMedia = computed(() => mediaList.value[mediaIndex.value])
let previewRequest = 0
const progressUnsubscribe = api.cliProgress?.(text => { installStatus.value = text })
onUnmounted(() => { progressUnsubscribe?.(); clearTips() })
watch(notice, text => { if (text) notify(text==='已复制到剪贴板'?'info':'success', text) })
function removeTip(id) {
  clearTimeout(tipTimers.get(id))
  tipTimers.delete(id)
  tips.value = tips.value.filter(tip => tip.id !== id)
}
function clearTips() { tips.value.forEach(tip => removeTip(tip.id)) }
async function showAbout() {
  try {
    project.value ??= await api.projectInfo()
    modal.value = 'about'
  } catch (error) { notify('error', setupMessage(error)) }
}
async function openProjectLink(name) {
  try { await api.openProjectLink(name) }
  catch (error) { notify('error', setupMessage(error)) }
}
async function openMacInstaller() {
  try { await api.openMacInstaller() }
  catch (error) { setupError.value = setupMessage(error) }
}
function notify(kind, text) {
  if (tips.value.length>=3) removeTip(tips.value[0].id)
  const id = ++tipId
  tips.value.push({id,kind,text})
  tipTimers.set(id, setTimeout(() => removeTip(id), kind==='error'||kind==='warning'?7500:4500))
}
watch(theme, value => {
  document.documentElement.dataset.theme = value
  localStorage.setItem('theme', value)
  api.setTheme?.(value)?.catch(error => console.error('Unable to apply window theme', error))
}, { immediate:true })
async function checkCli(install = false) {
  if (setupBusy.value) return
  setupBusy.value = true; setupError.value = ''; installStatus.value = ''
  try {
    const status = await (install ? api.installCli() : api.detectCli())
    if (!install) gated.value = status.gated
    if (!gated.value) {
      startup.value = 'ready'
      await refresh(normalize(folder.value))
      return
    }
    if (!status.installed) { startup.value = 'install'; return }
    startup.value = 'credentials'
    const restored = await api.restore(settings.proxy)
    if (restored) await enterSession(restored, true)
  } catch (error) {
    if (startup.value === 'checking') startup.value = 'install'
    setupError.value = setupMessage(error)
  } finally { setupBusy.value = false }
}
function setupMessage(error) {
  return error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
async function enterSession(value, restoring = false) {
  session.value = value
  startup.value = 'bucket'
  modal.value = ''
  tab.value = 'objects'
  rows.value = []; selected.value = []; token.value = ''; suggestedBucket.value = ''; bucketError.value = ''
  jobs.value = []; downloadJobs.value = []; transferOpen.value = false
  objectClipboard.value = null
  notice.value = ''; failure.value = ''
  if (!value.remembered) localStorage.removeItem(rememberedBucketKey)
  if (restoring && value.bucketScope) {
    let stored
    try { stored = JSON.parse(localStorage.getItem(rememberedBucketKey) || 'null') } catch {}
    if (stored?.scope === value.bucketScope && typeof stored.name === 'string') {
      suggestedBucket.value = stored.name
      await openBucket(stored.name)
    }
  }
}
async function submitCredentials(value) {
  if (setupBusy.value || sending.value || busy.value) return
  setupBusy.value = true; setupError.value = ''
  try { await enterSession(await api.signIn({ ...value, proxy:settings.proxy })) }
  catch (error) { setupError.value = setupMessage(error) }
  finally { setupBusy.value = false }
}
async function logout() {
  if (setupBusy.value || sending.value || busy.value) return
  setupBusy.value = true; setupError.value = ''
  try {
    await api.signOut()
    localStorage.removeItem(rememberedBucketKey)
    session.value = null
    startup.value = 'credentials'
    modal.value = ''; transferOpen.value = false
    rows.value = []; selected.value = []; jobs.value = []; downloadJobs.value = []
    objectClipboard.value = null
    link.value = ''; failure.value = ''; notice.value = ''
    clearTips()
  } catch (error) { setupError.value = setupMessage(error) }
  finally { setupBusy.value = false }
}
function switchBucket() {
  bucketError.value = ''
  modal.value = 'bucket'
}
async function openBucket(bucket) {
  if (busy.value || sending.value) return
  bucketError.value = ''
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..')) {
    bucketError.value = '请输入桶名，例如 media-demo。桶名不包含 s3:// 或文件路径。'
    return
  }
  busy.value = true
  try {
    const page = await fetchObjects(bucket, '')
    setBucket(bucket)
    settings.prefix = ''
    folder.value = ''; query.value = ''; selected.value = []
    rows.value = page.rows; token.value = page.token; loaded.value = true
    failure.value = ''; notice.value = ''
    persist()
    if (session.value?.bucketScope) {
      localStorage.setItem(rememberedBucketKey, JSON.stringify({scope:session.value.bucketScope, name:bucket}))
    }
    tab.value = 'objects'
    modal.value = ''
    startup.value = 'ready'
  } catch (error) {
    bucketError.value = /AccessDenied|Forbidden|403/i.test(error.message)
      ? '当前凭证无法列出此桶的对象，请确认桶名和访问权限。'
      : /NoSuchBucket/i.test(error.message) ? '找不到此存储桶，请检查桶名。' : error.message
  } finally { busy.value = false }
}
function dismissModal() {
  if (!setupBusy.value && !(busy.value && modal.value==='bucket')) modal.value = ''
}
const crumbs = computed(() => folder.value.split('/').filter(Boolean))
const count = computed(() => jobs.value.filter(j => j.state === '完成').length)
const downloaded = computed(() => downloadJobs.value.filter(job => job.state === '完成').length)
const visible = computed(() => rows.value.filter(r => r.name.toLowerCase().includes(query.value.trim().toLowerCase()))
  .sort((a,b) => Number(b.folder)-Number(a.folder) || (order.value === 'size' ? b.size-a.size : order.value === 'time' ? b.time.localeCompare(a.time) : 0) || a.name.localeCompare(b.name, 'zh-CN', { numeric:true })))
const allVisible = computed(() => visible.value.length > 0 && visible.value.every(r => selected.value.includes(r.key)))
const selection = computed(() => rows.value.filter(row => selected.value.includes(row.key)))
function toggleAll() {
  const keys = visible.value.map(r => r.key)
  selected.value = allVisible.value ? selected.value.filter(key => !keys.includes(key)) : [...new Set([...selected.value, ...keys])]
}
function persist() { localStorage.setItem('config', JSON.stringify({ ...settings, bucketSettings })) }
function setBucket(bucket, profile = settings.profile) {
  const keys = bucketSettings[profileKey(profile, bucket)]
  Object.assign(settings, { bucket, profile, cdn:'', keyId:'', privateKey:'', seconds:600 }, keys)
}
function size(n) {
  if (!n) return '0 B'
  const units = ['B','KB','MB','GB','TB'], i = Math.min(4,Math.floor(Math.log(n)/Math.log(1024)))
  return (n/1024**i).toLocaleString('zh-CN',{maximumFractionDigits:1})+' '+units[i]
}
function baseName(p) { return p.includes('/') ? p.split('/').pop() : p.split('\\').pop() }
function normalize(p) { return p.replace(/^\/+|\/+$/g,'') ? p.replace(/^\/+|\/+$/g,'')+'/' : '' }
async function invoke(action, data) {
  const r = await api.run(action, data)
  if (!r.ok) throw Error(r.error)
  return r.output
}
function copySelection(cut = false) {
  if (!selection.value.length || busy.value || sending.value) return
  objectClipboard.value = {
    bucket:settings.bucket,
    cut,
    items:selection.value.map(row => ({ key:row.key, name:row.name, folder:!!row.folder }))
  }
  notify('info', `已${cut?'剪切':'复制'} ${selection.value.length} 项。进入目标目录后点击「粘贴」。`)
}
async function pasteSelection() {
  const source = objectClipboard.value
  if (!source || busy.value || sending.value) return
  const targetBucket = settings.bucket
  const targetPrefix = folder.value
  const unresolved = [], errors = []
  await act(async () => {
    for (const item of source.items) {
      try {
        await invoke('paste', { ...settings, bucket:source.bucket, targetBucket, key:item.key,
          destination:targetPrefix + item.name + (item.folder?'/':''), folder:item.folder, cut:source.cut })
      } catch (error) {
        unresolved.push(item)
        errors.push(item.key + '：' + error.message)
      }
    }
    objectClipboard.value = unresolved.length ? { ...source, items:unresolved } : null
  })
  await refresh()
  if (errors.length) failure.value = errors.join('\n')
  const done = source.items.length - errors.length
  const label = source.cut ? '移动' : '复制'
  notify(errors.length?'warning':'success', errors.length
    ? `已${label} ${done} 项，${errors.length} 项未完成。`
    : `已${label} ${done} 项到当前目录。`)
}
function handleClipboardShortcut(event) {
  if ((!event.ctrlKey && !event.metaKey) || event.altKey || blocked.value || modal.value ||
    tab.value!=='objects' || busy.value || sending.value ||
    event.target.closest?.('input,textarea,select,[contenteditable]')) return
  const key = event.key.toLowerCase()
  if ((key==='c'||key==='x') && selection.value.length) {
    event.preventDefault()
    copySelection(key==='x')
  } else if (key==='v' && objectClipboard.value) {
    event.preventDefault()
    pasteSelection()
  }
}
async function fetchObjects(bucket, prefix, continuation = '') {
  const data = JSON.parse(await invoke('list', { ...settings, bucket, prefix, token:continuation }))
  const directories = (data.CommonPrefixes || []).map(x => ({key:x.Prefix,name:x.Prefix.slice(prefix.length,-1),folder:true,size:0,time:''}))
  const files = (data.Contents || []).filter(x => x.Key !== prefix).map(x => ({key:x.Key,name:x.Key.slice(prefix.length),size:x.Size,time:x.LastModified || ''}))
  return { rows:[...directories,...files], token:data.NextContinuationToken || '' }
}
async function refresh(path = folder.value, more = false) {
  if (busy.value) return
  busy.value = true
  failure.value = ''
  if (!more) { rows.value = []; selected.value = []; token.value = ''; loaded.value = false; folder.value = path; query.value = '' }
  try {
    const page = await fetchObjects(settings.bucket, path, more ? token.value : '')
    rows.value.push(...page.rows)
    loaded.value = true; token.value = page.token
  } catch(e) { failure.value = e.message } finally { busy.value = false }
}
async function act(task) {
  if (busy.value || sending.value) return
  busy.value = true; failure.value = ''; notice.value = ''
  try { await task() } catch(e) { failure.value = e.message } finally { busy.value = false }
}
async function download(item) {
  let destination
  await act(async () => { destination = await api.choose('save', item.name) })
  if (!destination) return
  downloadSource = { ...settings }
  downloadRoot.value = destination
  downloadJobs.value = [{ key:item.key, destination, state:'等待', result:'', error:'' }]
  await runDownloads(false)
}
async function startDownloads(items) {
  let destination
  await act(async () => { destination = await api.choose('destination') })
  if (!destination || !items.length) return
  downloadRoot.value = destination
  downloadSource = { ...settings }
  downloadJobs.value = items.map(item => ({key:item.key, folder:!!item.folder, state:'等待', result:'', error:''}))
  await runDownloads(false)
}
async function runDownloads(retry) {
  if (busy.value || sending.value) return
  const batch = downloadJobs.value.filter(job => job.state === (retry ? '失败' : '等待'))
  if (!batch.length) return
  sending.value = true
  transferTab.value = 'download'
  transferOpen.value = true
  batch.forEach(job => { job.state='等待'; job.error='' })
  try {
    for (const job of batch) {
      job.state = '下载中'
      try {
        if (job.destination) {
          await invoke('download', { ...downloadSource, key:job.key, destination:job.destination })
          job.result = job.destination
        } else {
          job.result = await invoke('download-to-folder', {
            ...downloadSource, key:job.key, folder:job.folder, root:downloadRoot.value
          })
        }
        job.state = '完成'
      } catch (error) {
        job.state = '失败'
        job.error = error.message
      }
    }
  } finally { sending.value = false }
  const failed = batch.filter(job => job.state==='失败').length
  notify(failed?'warning':'success', failed ? `下载完成 ${batch.length-failed} 项，${failed} 项失败。可在传输面板重试。` : `已下载 ${batch.length} 项`)
}
function sign(item) { return act(async () => {
  link.value = await invoke('sign',{...settings,key:item.key})
  signedLink.value = true; linkKey.value = item.key; modal.value = 'link'
}) }
function directLink(item) { return act(async () => {
  link.value = await invoke('direct-url', { ...settings, key:item.key })
  signedLink.value = false; linkKey.value = item.key; modal.value = 'link'
}) }
function nameKey(name, directory) {
  const clean = name.trim()
  if (!clean || /[\/\\]/.test(clean) || clean === '.' || clean === '..') throw Error('请输入单个名称，不能包含斜杠')
  const key = folder.value + clean + (directory ? '/' : '')
  if (new TextEncoder().encode(key).length > 1024) throw Error('S3 对象键不能超过 1024 字节')
  return key
}
function openRename(item) {
  renameItem.value = item
  nameInput.value = item.name
  modal.value = 'rename'
}
async function saveName() {
  let changed = false
  await act(async () => {
    const item = modal.value === 'rename' ? renameItem.value : null
    const destination = nameKey(nameInput.value, item ? item.folder : true)
    if (item && destination === item.key) { modal.value = ''; return }
    modal.value = ''
    if (item) await invoke('rename', { ...settings, key:item.key, folder:item.folder, destination })
    else await invoke('mkdir', { ...settings, key:destination })
    notice.value = item ? '已重命名' : '已创建目录'
    changed = true
  })
  const error = failure.value
  if (changed || (error && !modal.value)) await refresh()
  if (error) failure.value = error
}
function prepareDelete() { return act(async () => {
  const targets = new Map()
  for (const row of rows.value.filter(row => selected.value.includes(row.key))) {
    const objects = JSON.parse(await invoke('targets', { ...settings, key:row.key, folder:row.folder }))
    for (const object of objects) targets.set(object.Key, object)
  }
  deletePlan.value = [...targets.values()]
  if (!deletePlan.value.length) throw Error('所选对象已不存在')
  modal.value = 'delete'
}) }
async function confirmDelete() {
  const errors = []
  await act(async () => {
    modal.value = ''
    for (const object of deletePlan.value) {
      try { await invoke('delete', { ...settings, key:object.Key, etag:object.ETag }) }
      catch (error) { errors.push(object.Key + '：' + error.message) }
    }
    notice.value = '已删除 ' + (deletePlan.value.length - errors.length) + ' 个对象'
  })
  await refresh()
  if (errors.length) failure.value = errors.join('\n')
}
function mediaKind(key) {
  if (/\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i.test(key)) return 'image'
  return /\.(mp4|webm|m4v|mov|ogg|ogv)$/i.test(key) ? 'video' : ''
}
async function clearPreview() {
  const old = mediaUrl.value
  mediaUrl.value = ''
  await nextTick()
  if (old) await api.releasePreview(old)
}
async function showPreview(index) {
  const request = ++previewRequest
  mediaIndex.value = index
  mediaError.value = ''
  mediaLoading.value = true
  await clearPreview()
  try {
    const url = await api.preview({ ...settings, key:currentMedia.value.key })
    if (request === previewRequest && modal.value === 'preview') mediaUrl.value = url
    else await api.releasePreview(url)
  } catch (error) {
    if (request === previewRequest) mediaError.value = error.message
  } finally {
    if (request === previewRequest) mediaLoading.value = false
  }
}
function openPreview(item) {
  mediaList.value = visible.value.filter(row => !row.folder && mediaKind(row.key))
  modal.value = 'preview'
  showPreview(mediaList.value.findIndex(row => row.key === item.key))
}
function stepPreview(offset) {
  const index = mediaIndex.value + offset
  if (!mediaLoading.value && index >= 0 && index < mediaList.value.length) showPreview(index)
}
watch(modal, (value, previous) => {
  if (previous === 'preview' && value !== 'preview') { previewRequest++; clearPreview() }
})
const canDrop = computed(() => !blocked.value && !modal.value && tab.value==='objects' && !busy.value && !sending.value)
function hasLocalFiles(event) { return event.dataTransfer?.types.includes('Files') }
function showDropTarget(event) {
  if (!hasLocalFiles(event)) return
  dragOver.value = canDrop.value
  event.dataTransfer.dropEffect = canDrop.value ? 'copy' : 'none'
}
function hideDropTarget(event) {
  if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) dragOver.value = false
}
async function handleDrop(event) {
  dragOver.value = false
  if (!hasLocalFiles(event) || !canDrop.value) return
  try {
    const paths = Array.from(event.dataTransfer.files, api.filePath).filter(Boolean)
    if (!paths.length) { notify('warning','没有可上传的本地文件或目录'); return }
    await selectUploads(paths)
  } catch (error) { notify('error',setupMessage(error)) }
}
async function selectUploads(paths) {
  if (!paths.length || !canDrop.value) return
  busy.value = true
  try {
    pending.value = await api.inspectUpload([...new Set(paths)])
    modal.value = 'upload'
  } catch (error) { notify('error', setupMessage(error)) }
  finally { busy.value = false }
}
async function chooseFiles() {
  try { await selectUploads(await api.choose('files')) }
  catch (error) { notify('error',setupMessage(error)) }
}
async function upload(retry = false) {
  if (busy.value || sending.value) return
  if (!retry) jobs.value = pending.value.map(item => ({...item,state:'等待',error:''}))
  const batch = jobs.value.filter(j => !retry || j.state === '失败')
  if (!batch.length) return
  const destination = retry ? lastTarget : { ...settings, prefix:folder.value }
  lastTarget = destination
  batch.forEach(j => { j.state='等待'; j.error='' })
  sending.value=true; modal.value=''; transferTab.value='upload'; transferOpen.value=true
  try {
    for (const job of batch) {
      job.state='上传中'
      try { await invoke('upload-item',{ ...destination,file:job.file,folder:job.folder }); job.state='完成' }
      catch(e) { job.state='失败'; job.error=e.message }
    }
  } finally { sending.value=false }
  const failed = batch.filter(job => job.state==='失败').length
  notify(failed?'warning':'success', failed ? `上传完成 ${batch.length-failed} 项，${failed} 项失败。可在传输面板重试。` : `已上传 ${batch.length} 项`)
  if (settings.bucket===destination.bucket && folder.value===destination.prefix && settings.profile===destination.profile) await refresh()
}
let lastTarget = {}
function configure() {
  Object.assign(draft,settings)
  if (gated.value) { modal.value=''; tab.value='settings' }
  else modal.value='settings'
}
watch(() => [draft.bucket?.trim(), draft.profile?.trim()], ([bucket, profile]) => {
  if (modal.value !== 'settings') return
  Object.assign(draft, { cdn:'', keyId:'', privateKey:'', seconds:600 }, bucketSettings[profileKey(profile,bucket)])
}, { flush:'sync' })
function apply() {
  const bucket = draft.bucket.trim()
  const profile = draft.profile.trim()
  if (!bucket || /[\s/]/.test(bucket)) {
    failure.value = '请输入有效的存储桶名称'
    return
  }
  const prefix = bucket === settings.bucket && profile === settings.profile ? folder.value : ''
  if (profile!==settings.profile) objectClipboard.value = null
  const { cdn, keyId, privateKey, seconds } = draft
  bucketSettings[profileKey(profile,bucket)] = { cdn, keyId, privateKey, seconds }
  setBucket(bucket, profile)
  Object.assign(settings,{ proxy:draft.proxy.trim(), prefix })
  persist(); modal.value=''; notice.value='配置已保存'
  if (!gated.value) { tab.value = 'objects'; refresh(prefix) }
}
async function chooseKey() { draft.privateKey = await api.choose('key') || draft.privateKey }
async function copy(text) { await api.copy(text); notice.value='已复制到剪贴板' }
onMounted(() => api.detectCli ? checkCli() : refresh(normalize(folder.value)).finally(() => { gated.value=false; startup.value='ready' }))
</script>

<template>
<div :class="{'windows-window':api.windows}" @keydown="handleClipboardShortcut" @keydown.esc="dismissModal" @keydown.left="modal==='preview' && stepPreview(-1)" @keydown.right="modal==='preview' && stepPreview(1)" @dragover.prevent @drop.prevent>
<div v-if="api.windows" class="window-titlebar"><img src="./assets/cloud-courier.png" alt="">S3 Desktop</div>
<div class="shell" :inert="blocked||!!modal">
  <aside>
    <div class="brand"><img class="mark" src="./assets/cloud-courier.png" alt=""> S3 Desktop</div>
    <nav v-if="!blocked">
      <button :class="{active:tab==='objects'}" @click="tab='objects'">▦　资源浏览</button>
    </nav>
    <template v-if="!blocked">
      <button class="settings" :class="{active:tab==='settings'}" :disabled="busy||sending" @click="configure">⚙　设置</button>
      <button v-if="!gated" @click="modal='guide'">？　签名配置教程</button>
    </template>
  </aside>
  <main @dragover.prevent="showDropTarget" @dragleave="hideDropTarget" @drop.prevent="handleDrop">
    <Transition name="page" mode="out-in">
    <div v-if="!blocked" :key="tab" class="page-view">
    <header class="workspace-toolbar"><div><div class="eyebrow">S3<span v-if="tab==='objects'"> / {{settings.bucket}}</span></div><h1>{{tab==='settings'?'设置':'资源浏览'}}</h1></div>
      <div v-if="tab==='objects'" class="actions workspace-actions">
        <button :disabled="busy||sending||(!objectClipboard&&!selection.length)"
          @click="objectClipboard?pasteSelection():copySelection()">{{objectClipboard?'粘贴':'复制'}}</button>
        <button :disabled="busy||sending||!selection.length" @click="copySelection(true)">剪切</button>
        <button :disabled="busy||sending" @click="nameInput='';modal='mkdir'">新建目录</button>
        <button class="primary" :disabled="busy||sending" @click="chooseFiles">＋ 上传文件</button>
      </div>
    </header>
    <Transition name="tip"><p v-if="failure && tab==='objects'" class="tip tip-error" role="alert">{{failure}}</p></Transition>
    <section v-if="tab==='settings'" class="settings-page">
      <h2>外观</h2><div class="setting-group"><div class="setting-row"><span>主题</span><div class="segments" aria-label="应用主题">
        <button :aria-pressed="theme==='light'" @click="theme='light'">Light</button><button :aria-pressed="theme==='dark'" @click="theme='dark'">Dark</button>
      </div></div></div>
      <h2>AWS 凭证</h2><div class="setting-group">
        <div class="setting-row"><span>当前凭证</span><span class="muted">{{session?.masked}} · {{session?.remembered?'已保存':'仅本次使用'}}</span></div>
        <button class="setting-row" :disabled="busy||sending" @click="setupError='';modal='switch'"><span>切换凭证</span><span aria-hidden="true">›</span></button>
        <button class="setting-row text-danger" :disabled="busy||sending" @click="setupError='';modal='logout'"><span>退出登录</span><span aria-hidden="true">›</span></button>
      </div>
      <h2>存储桶</h2><div class="setting-group">
        <button class="setting-row" :disabled="busy||sending" @click="switchBucket"><span>切换存储桶</span><span class="muted">{{settings.bucket}}　›</span></button>
      </div>
      <h2>连接与签名</h2>
      <form class="setting-group setting-form" @submit.prevent="apply">
        <label>代理地址<input v-model="draft.proxy" placeholder="http://127.0.0.1:8801"></label>
        <template v-if="settings.bucket">
          <p class="muted">CloudFront 设置适用于 {{settings.bucket}}</p>
          <label>CDN 基础地址<input v-model="draft.cdn" type="url"></label>
          <div class="pair"><label>CloudFront 公钥 ID<input v-model="draft.keyId" placeholder="仅生成签名地址时需要"></label><label>有效期（秒）<input type="number" min="1" step="1" required v-model.number="draft.seconds"></label></div>
          <label>PEM 私钥</label><div class="inline"><input aria-label="私钥路径" v-model="draft.privateKey" placeholder="选择本机 PEM 文件"><button type="button" @click="chooseKey">浏览</button></div>
        </template>
        <div class="dialog-actions"><button type="button" @click="modal='guide'">签名配置教程</button><button class="primary" :disabled="busy||sending">保存设置</button></div>
      </form>
      <h2>项目</h2><div class="setting-group">
        <button class="setting-row" @click="showAbout"><span>关于 S3 Desktop</span><span aria-hidden="true">›</span></button>
      </div>
    </section>
    <template v-if="tab==='objects'">
      <div class="crumbs"><button v-if="gated" :disabled="busy||sending" @click="switchBucket">切换存储桶</button><span v-if="gated">/</span><button :disabled="busy" @click="refresh('')">{{settings.bucket}}</button>
        <template v-for="(c,i) in crumbs" :key="i"><span>/</span><button :disabled="busy" @click="refresh(crumbs.slice(0,i+1).join('/')+'/')">{{c}}</button></template>
        <button class="quiet" :disabled="busy" @click="jump=folder;modal='jump'">转到目录…</button></div>
      <div v-if="objectClipboard" class="clipboard-bar">
        <span>已{{objectClipboard.cut?'剪切':'复制'}} {{objectClipboard.items.length}} 项</span>
        <button :disabled="busy||sending" @click="objectClipboard=null">清除待粘贴项</button>
      </div>
      <Transition name="page" mode="out-in" @before-leave="element => element.inert=true">
        <section :key="folder" :data-prefix="folder" class="panel">
        <div class="tools"><input v-model="query" type="search" aria-label="筛选已加载的资源" placeholder="搜索已加载的资源">
          <select v-model="order" aria-label="排序"><option value="name">名称排序</option><option value="size">大小优先</option><option value="time">最近修改</option></select>
          <button :disabled="busy||sending" @click="refresh()">刷新</button></div>
        <div v-if="selected.length" class="selection tools"><strong>已选 {{selected.length}} 项</strong>
          <button :disabled="busy||sending" @click="startDownloads(rows.filter(row=>selected.includes(row.key)))">下载所选</button>
          <button :disabled="busy||sending" @click="selected=[]">清除选择</button>
          <button class="danger" :disabled="busy||sending" @click="prepareDelete">删除所选</button></div>
        <table class="objects"><thead><tr><th class="check"><input type="checkbox" aria-label="全选当前显示项" :checked="allVisible" :disabled="!visible.length||busy||sending" @change="toggleAll"></th><th>名称</th><th>大小</th><th class="date">修改日期</th><th>操作</th></tr></thead><tbody>
          <tr v-for="r in visible" :key="r.key" :class="{chosen:selected.includes(r.key)}"><td class="check"><input v-model="selected" type="checkbox" :value="r.key" :aria-label="'选择 '+r.name" :disabled="busy||sending"></td><td class="object-name"><div class="file"><span class="tile" :class="{dir:r.folder}">{{r.folder?'▰':'▤'}}</span>
          <button v-if="r.folder" class="folder" :disabled="busy" @click="refresh(r.key)">{{r.name}}/</button><span v-else>{{r.name}}</span></div></td>
          <td>{{r.folder?'—':size(r.size)}}</td><td class="date">{{r.time?new Date(r.time).toLocaleDateString('zh-CN'):'—'}}</td>
          <td><div class="actions object-actions">
            <button v-if="r.folder" :disabled="busy||sending" @click="startDownloads([r])">下载文件夹</button>
            <template v-else>
              <button v-if="mediaKind(r.key)" :disabled="busy||sending" @click="openPreview(r)">预览</button>
              <button :disabled="busy||sending" @click="download(r)">下载</button>
              <button :disabled="busy||sending" @click="directLink(r)">S3 直链</button>
              <button :disabled="busy||sending" @click="sign(r)">签名地址</button>
            </template>
            <button :disabled="busy||sending" :aria-label="'重命名 '+r.name" @click="openRename(r)">重命名</button>
          </div></td></tr>
        </tbody></table>
        <div v-if="!visible.length" class="empty">{{busy?'正在读取资源…':failure&&!loaded?'未能读取目录':query?'没有匹配的资源':'此目录为空'}}</div>
        <footer><span>显示 {{visible.length}} / 已加载 {{rows.length}} 项</span><span class="muted drag-hint">可拖入文件或文件夹上传</span><button v-if="token" :disabled="busy||sending" @click="refresh(folder,true)">加载更多</button></footer>
      </section></Transition>
    </template>
    </div>
    </Transition>
    <Transition name="tip"><div v-if="dragOver&&canDrop" class="drop-target" aria-hidden="true"><strong>松开以上传到当前目录</strong><span>s3://{{settings.bucket}}/{{folder}}</span></div></Transition>
  </main>
  <div v-if="!blocked" class="transfer-dock">
    <Transition name="popover">
    <div v-if="transferOpen" id="transfer-panel" class="transfer-panel" aria-label="传输队列">
    <div class="transfer-heading"><strong>传输</strong><div class="segments" aria-label="传输类型">
      <button :aria-pressed="transferTab==='upload'" @click="transferTab='upload'">上传</button>
      <button :aria-pressed="transferTab==='download'" @click="transferTab='download'">下载</button>
    </div></div>
    <Transition name="page" mode="out-in">
    <section v-if="transferTab==='upload'" key="upload"><div class="tools"><strong>{{jobs.length?'已完成 '+count+' / '+jobs.length:'当前批次'}}</strong>
      <button v-if="jobs.some(j=>j.state==='失败')" :disabled="sending||busy" @click="upload(true)">重试失败项</button></div>
      <div class="empty" v-if="!jobs.length">从资源浏览中选择文件，即可开始上传。</div>
      <template v-else><div class="track"><i :style="{width:100*count/jobs.length+'%'}"></i></div>
      <div class="job" v-for="j in jobs" :key="j.file"><div><strong>{{baseName(j.file)}}</strong><p>{{j.file}}</p><p v-if="j.error" class="error">{{j.error}}</p></div><b>{{j.state}}</b></div></template>
    </section>
    <section v-else key="download">
      <div class="tools"><strong>{{downloadJobs.length?'已完成 '+downloaded+' / '+downloadJobs.length:'当前批次'}}</strong>
        <button v-if="downloadJobs.some(job=>job.state==='失败')" :disabled="busy||sending" @click="runDownloads(true)">重试失败项</button></div>
      <div v-if="!downloadJobs.length" class="empty">勾选资源后点击「下载所选」，或在目录行点击「下载文件夹」。</div>
      <template v-else>
        <div class="track"><i :style="{width:100*downloaded/downloadJobs.length+'%'}"></i></div>
        <div class="job" v-for="job in downloadJobs" :key="job.key"><div><strong>{{job.key}}</strong>
          <p>{{job.result||downloadRoot}}</p><p v-if="job.error" class="error">{{job.error}}</p></div><b>{{job.state}}</b></div>
      </template>
    </section>
    </Transition>
    </div>
    </Transition>
    <button class="primary transfer-toggle" aria-controls="transfer-panel" :aria-expanded="transferOpen" @click="transferOpen=!transferOpen">⇅　传输 <span v-if="jobs.length+downloadJobs.length">{{jobs.length+downloadJobs.length}}</span> {{transferOpen?'⌄':'⌃'}}</button>
  </div>
</div>
  <TransitionGroup name="tip" tag="div" class="toast-stack" aria-label="操作提示">
    <div v-for="tip in tips" :key="tip.id" :class="['tip','toast','tip-'+tip.kind]" :role="tip.kind==='error'?'alert':'status'">
      <span aria-hidden="true">{{{success:'✓',info:'ℹ',warning:'⚠',error:'!'}[tip.kind]}}</span><span>{{tip.text}}</span>
      <button aria-label="关闭提示" @click="removeTip(tip.id)">×</button>
    </div>
  </TransitionGroup>
  <Transition name="overlay">
  <div v-if="blocked" class="veil startup-veil">
    <Transition name="page" mode="out-in">
    <section v-if="startup==='checking'" key="checking" class="checking" role="status"><i class="spinner"></i> 正在检测 AWS CLI…</section>
    <section v-else-if="startup==='install'" key="install" class="dialog" role="dialog" aria-modal="true" aria-label="安装 AWS CLI">
      <div class="dialog-symbol" aria-hidden="true">↓</div>
      <h2>安装 AWS CLI</h2><p class="muted">{{api.windows?'未检测到 AWS CLI v2。安装并检测通过后会自动继续。':'未检测到 AWS CLI v2。打开官方安装包完成安装，然后点击「重新检测」。'}}</p>
      <p v-if="setupError" class="tip tip-error" role="alert">{{setupError}}</p>
      <p v-if="installStatus" class="tip tip-info" role="status"><i v-if="setupBusy" class="spinner"></i> {{installStatus}}</p>
      <div class="dialog-actions"><button :disabled="setupBusy" @click="checkCli()">重新检测</button>
        <button v-if="api.windows" class="primary" :disabled="setupBusy" @click="checkCli(true)">一键安装 AWS CLI</button>
        <button v-else class="primary" :disabled="setupBusy" @click="openMacInstaller">下载官方安装包</button>
      </div>
    </section>
    <section v-else-if="startup==='credentials'" key="credentials" class="dialog" role="dialog" aria-modal="true" aria-label="输入 AWS 凭证">
      <CredentialsForm :busy="setupBusy" :error="setupError" @submit="submitCredentials"/>
    </section>
    <section v-else key="bucket" class="dialog" role="dialog" aria-modal="true" aria-label="输入存储桶名称">
      <BucketForm :current="suggestedBucket" :busy="busy" :error="bucketError" @submit="openBucket"/>
    </section>
    </Transition>
  </div>
  </Transition>
  <Transition name="overlay">
  <div v-if="modal" class="veil" @click.self="dismissModal"><section class="dialog" :class="{wide:modal==='preview'||modal==='guide'}" role="dialog" aria-modal="true" :aria-label="({settings:'连接与签名设置',switch:'切换 AWS 凭证',bucket:'切换存储桶',logout:'退出登录',upload:'确认上传',jump:'转到目录',link:'资源链接',mkdir:'新建目录',rename:'重命名',delete:'确认删除',preview:'媒体预览',guide:'签名配置教程',about:'关于 S3 Desktop'})[modal]">
    <button class="close" aria-label="关闭" :disabled="setupBusy||(modal==='bucket'&&busy)" @click="dismissModal">×</button>
    <div v-if="modal==='about'&&project" class="about">
      <img class="about-icon" src="./assets/cloud-courier.png" alt="">
      <h2>S3 Desktop</h2><p class="muted">版本 {{project.version}}</p>
      <dl>
        <div><dt>开发者</dt><dd><button @click="openProjectLink('developerUrl')">{{project.developer}} ↗</button></dd></div>
        <div v-if="project.repositoryUrl"><dt>源码</dt><dd><button @click="openProjectLink('repositoryUrl')">打开 GitHub 仓库 ↗</button></dd></div>
        <div><dt>许可</dt><dd><button @click="openProjectLink('licenseUrl')">PolyForm Noncommercial 1.0.0 ↗</button></dd></div>
      </dl>
      <p class="muted">欢迎按许可条款修改和分发。商用需另行取得授权。</p>
    </div>
    <BucketForm v-if="modal==='bucket'" switching :current="settings.bucket" :busy="busy" :error="bucketError" @submit="openBucket" @cancel="dismissModal"/>
    <CredentialsForm v-if="modal==='switch'" switching :busy="setupBusy" :error="setupError" @submit="submitCredentials" @cancel="dismissModal"/>
    <div v-if="modal==='logout'"><h2>退出登录？</h2><p>退出后将回到凭证输入。此应用保存的登录凭证会被移除。</p>
      <p v-if="setupError" class="tip tip-error" role="alert">{{setupError}}</p>
      <div class="dialog-actions"><button :disabled="setupBusy" @click="dismissModal">取消</button><button class="danger" :disabled="setupBusy" @click="logout">退出登录</button></div>
    </div>
    <form v-if="modal==='settings'" @submit.prevent="apply"><h2>连接与签名设置</h2>
      <label>存储桶名称<input v-model="draft.bucket" required></label><div class="pair"><label>AWS Profile<input v-model="draft.profile" placeholder="默认配置"></label><label>代理地址<input v-model="draft.proxy" placeholder="http://127.0.0.1:8801"></label></div>
      <h3>CloudFront 签名</h3><label>CDN 基础地址<input v-model="draft.cdn" type="url"></label><div class="pair"><label>CloudFront 公钥 ID<input v-model="draft.keyId" placeholder="仅生成签名地址时需要"></label><label>有效期（秒）<input type="number" min="1" step="1" required v-model.number="draft.seconds"></label></div>
      <label>私钥文件</label><div class="inline"><input aria-label="私钥路径" v-model="draft.privateKey" placeholder="选择本机 PEM 文件"><button type="button" @click="chooseKey">浏览</button></div><button class="primary end">保存设置</button></form>
    <form v-if="modal==='jump'" @submit.prevent="modal='';refresh(normalize(jump))"><h2>转到目录</h2><label>S3 前缀<input v-model="jump" placeholder="例如 media/videos/"></label><button class="primary end">打开目录</button></form>
    <div v-if="modal==='upload'"><h2>确认上传 {{pending.length}} 项</h2><p>目标目录 <strong>s3://{{settings.bucket}}/{{folder}}</strong></p>
      <ul><li v-for="p in pending" :key="p.file">{{baseName(p.file)}}<span v-if="p.folder">/（文件夹）</span></li></ul>
      <p>同名文件会覆盖目标目录中的对象。</p>
      <div class="dialog-actions"><button @click="dismissModal">取消</button><button class="primary" @click="upload(false)">开始上传</button></div>
    </div>
    <div v-if="modal==='link'"><h2>{{signedLink?'CloudFront 签名地址':'S3 直链'}}</h2><p>{{linkKey}} <span v-if="signedLink">· 有效期 {{settings.seconds}} 秒</span></p><p v-if="!signedLink">此链接不带签名，私有对象通常会返回 403。</p><textarea :value="link" readonly aria-label="资源链接"></textarea><button class="primary end" @click="copy(link);modal=''">复制链接</button></div>
    <form v-if="modal==='mkdir'||modal==='rename'" @submit.prevent="saveName">
      <h2>{{modal==='mkdir'?'新建目录':renameItem.folder?'重命名目录':'重命名文件'}}</h2>
      <p v-if="modal==='rename'">{{renameItem.key}}。{{renameItem.folder?'目录中的对象会一起移动。':''}}S3 会先复制，再删除旧路径下的对象。</p>
      <p v-if="failure" class="alert">{{failure}}</p>
      <label>名称<input v-model="nameInput" required></label><button class="primary end" :disabled="busy">{{modal==='mkdir'?'创建目录':'确认重命名'}}</button>
    </form>
    <div v-if="modal==='delete'"><h2>确认删除 {{deletePlan.length}} 个对象</h2>
      <p>存储桶 {{settings.bucket}}。列表包含所选目录下将被删除的对象。</p>
      <ul><li v-for="object in deletePlan" :key="object.Key">{{object.Key}}</li></ul>
      <button class="danger end" :disabled="busy" @click="confirmDelete">确认删除</button>
    </div>
    <div v-if="modal==='preview'&&currentMedia"><h2>{{currentMedia.name}}</h2>
      <div class="media-stage">
        <p v-if="mediaLoading">正在下载预览文件（{{size(currentMedia.size)}}）…</p><p v-else-if="mediaError" class="alert">{{mediaError}}</p>
        <img v-else-if="mediaUrl&&mediaKind(currentMedia.key)==='image'" :src="mediaUrl" :alt="currentMedia.name" @error="mediaError='无法显示该图片'">
        <video v-else-if="mediaUrl" :key="mediaUrl" :src="mediaUrl" controls playsinline @error="mediaError='无法播放该视频或编码不受支持'"></video>
      </div>
      <footer><button :disabled="mediaLoading||mediaIndex===0" @click="stepPreview(-1)">← 上一项</button>{{mediaIndex+1}} / {{mediaList.length}}<button :disabled="mediaLoading||mediaIndex+1===mediaList.length" @click="stepPreview(1)">下一项 →</button></footer>
    </div>
    <div v-if="modal==='guide'" class="guide"><h2>CloudFront 签名配置教程</h2>
      <p>如果你已有可用的签名命令，直接把 <code>--key-pair-id</code> 的值和 <code>--private-key</code> 指向的 PEM 文件填入所选存储桶的设置。</p>
      <ol><li>首次配置时，用 OpenSSL 生成 RSA 2048 私钥并导出公钥。<pre>openssl genrsa -out private_key.pem 2048
openssl rsa -in private_key.pem -pubout -out public_key.pem</pre></li>
      <li>在 CloudFront 的 Public keys 中上传 <code>public_key.pem</code>。记录这条公钥的 ID。</li>
      <li>在 Key groups 中添加这条公钥。在分配的 Behaviors 中编辑对应路径，启用 Restrict viewer access，并选择该 Key group。</li>
      <li>在本工具打开对应的存储桶。设置 CDN 基础地址（例如 <code>https://cdn.example.com</code>）、公钥 ID、本机的 <code>private_key.pem</code> 和有效期。私钥只保留在本机。</li>
      <li>对一个对象点击「签名地址」并测试。遇到 403 时，检查 CDN 路径、公私钥是否配对、Behavior 是否关联该组，以及链接是否过期。</li></ol>
      <button class="end" :disabled="busy||sending" @click="configure">打开连接与签名设置</button>
    </div>
  </section></div>
  </Transition>
</div></template>
