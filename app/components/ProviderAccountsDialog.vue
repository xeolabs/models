<script setup lang="ts">
import { ref, watch } from 'vue';
import { ElDialog, ElButton, ElInput, ElSelect, ElOption } from 'element-plus';
import { useProviderAccounts } from '../stores/providerAccounts';
const accounts = useProviderAccounts();
const method = ref<'api-token' | 'oauth'>('api-token');
const token = ref('');
watch(
  () => accounts.open,
  (open) => {
    token.value = '';
    if (open) void accounts.refresh();
  },
);
async function save() {
  const value = token.value;
  token.value = '';
  await accounts.connect(method.value, value);
}
</script>
<template>
  <el-dialog
    v-model="accounts.open"
    title="Provider accounts"
    width="min(540px, calc(100vw - 32px))"
    append-to-body
  >
    <section class="provider-account" aria-label="Sketchfab authentication">
      <h2>Sketchfab</h2>
      <p v-if="accounts.status?.configured" role="status">
        Configured as <strong>{{ accounts.status.username }}</strong>
      </p>
      <p class="section-note">Saved for this Models server and restored after restart.</p>
      <form @submit.prevent="save">
        <label
          >Authentication
          <el-select
            v-model="method"
            :disabled="accounts.busy"
            aria-label="Sketchfab authentication type"
          >
            <el-option label="API token" value="api-token" />
            <el-option label="OAuth access token" value="oauth" />
          </el-select>
        </label>
        <label
          >{{ accounts.status?.configured ? 'Replacement token' : 'Token' }}
          <el-input
            v-model="token"
            type="password"
            show-password
            autocomplete="off"
            :disabled="accounts.busy"
            aria-label="Sketchfab token"
            placeholder="Paste your Sketchfab token"
          />
        </label>
        <div class="provider-account-actions">
          <el-button
            type="primary"
            native-type="submit"
            :loading="accounts.busy"
            :disabled="!token.trim()"
            >Verify and save</el-button
          >
          <el-button
            v-if="accounts.status?.configured"
            :disabled="accounts.busy"
            @click="accounts.verify()"
            >Test saved connection</el-button
          >
          <el-button
            v-if="accounts.status?.configured"
            :disabled="accounts.busy"
            @click="accounts.disconnect()"
            >Disconnect</el-button
          >
        </div>
      </form>
      <p v-if="accounts.error" role="alert" class="acquisition-error">{{ accounts.error }}</p>
      <a
        href="https://sketchfab.com/developers/data-api/v3"
        target="_blank"
        rel="noopener noreferrer"
        >Sketchfab token and authentication help</a
      >
    </section>
    <template #footer><el-button @click="accounts.open = false">Done</el-button></template>
  </el-dialog>
</template>
<style scoped>
.provider-account {
  display: grid;
  gap: 12px;
}
.provider-account h2,
.provider-account p {
  margin: 0;
}
.provider-account form,
.provider-account label {
  display: grid;
  gap: 8px;
}
.provider-account form {
  gap: 16px;
}
.provider-account-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.provider-account-actions :deep(.el-button + .el-button) {
  margin-left: 0;
}
</style>
