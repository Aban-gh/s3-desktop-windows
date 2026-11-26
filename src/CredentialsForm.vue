<script setup>
import { ref } from 'vue'

defineProps({ switching:Boolean, busy:Boolean, error:String })
const emit = defineEmits(['submit','cancel'])
const id = ref(''), secret = ref(''), remember = ref(false), reveal = ref(false)
function submit() {
  emit('submit', { id:id.value, secret:secret.value, remember:remember.value })
}
</script>

<template>
  <form @submit.prevent="submit">
    <div class="dialog-symbol" aria-hidden="true">⌘</div>
    <h2>{{switching?'切换 AWS 凭证':'输入 AWS 凭证'}}</h2>
    <p class="muted">{{switching?'验证新凭证后将重新加载存储桶。':'验证后自动加载存储桶。'}}</p>
    <p v-if="error" class="tip tip-error" role="alert">{{error}}</p>
    <fieldset :disabled="busy">
      <label>Access Key ID<input v-model.trim="id" autocomplete="off" spellcheck="false" required></label>
      <label for="aws-secret">Secret Access Key</label>
      <div class="inline">
        <input id="aws-secret" v-model="secret" :type="reveal?'text':'password'" autocomplete="off" spellcheck="false" required>
        <button type="button" :aria-pressed="reveal" @click="reveal=!reveal">{{reveal?'隐藏':'显示'}}</button>
      </div>
      <label class="remember"><input type="checkbox" v-model="remember">记住凭证</label>
      <p class="muted">{{remember?'保存到本机 AWS 凭证文件。':'仅本次使用，退出后需重新输入。'}}</p>
    </fieldset>
    <div class="dialog-actions">
      <button v-if="switching" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
      <button class="primary" :disabled="busy||!id||!secret">{{busy?'正在验证…':switching?'验证并切换':'验证并继续'}}</button>
    </div>
  </form>
</template>
