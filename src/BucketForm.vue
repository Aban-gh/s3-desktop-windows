<script setup>
import { onMounted, ref } from 'vue'

const props = defineProps({ current:String, switching:Boolean, busy:Boolean, error:String })
const emit = defineEmits(['submit', 'cancel'])
const name = ref(props.current || '')
const field = ref(null)
onMounted(() => { field.value?.focus(); if (props.switching) field.value?.select() })
</script>

<template>
  <form @submit.prevent="emit('submit', name)">
    <div class="dialog-symbol" aria-hidden="true">▰</div>
    <h2>{{switching?'切换存储桶':'输入存储桶名称'}}</h2>
    <p class="muted">输入有访问权限的 S3 桶名。</p>
    <p v-if="error" class="tip tip-error" role="alert">{{error}}</p>
    <label>存储桶名称<input ref="field" v-model.trim="name" spellcheck="false" autocomplete="off"
      placeholder="例如 media-demo" :disabled="busy" required></label>
    <div class="dialog-actions">
      <button v-if="switching" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
      <button class="primary" :disabled="busy||!name">{{busy?'正在读取…':'打开存储桶'}}</button>
    </div>
  </form>
</template>
