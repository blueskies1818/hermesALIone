# Hermes Desktop — IPC API Reference

The Desktop exposes 100+ IPC methods through `window.hermesAPI` via Electron's `contextBridge`. All methods are async and return Promises.

## Preload Files

| File | Size | Purpose |
|------|------|---------|
| `src/preload/index.ts` | 33 KB | Full API implementation — contextBridge exposure of all IPC channels |
| `src/preload/index.d.ts` | 22 KB | TypeScript type declarations |
| `src/preload/askpass.ts` | — | SSH askpass credential forwarding |

## API Categories

### Installation & Updates
```typescript
checkInstall(): Promise<InstallState>
verifyInstall(): Promise<VerifyResult>
startInstall(config: InstallConfig): Promise<void>
onInstallProgress(cb: (progress: Progress) => void): () => void
getHermesVersion(): Promise<string>
refreshHermesVersion(): Promise<string>
runHermesDoctor(): Promise<DoctorResult>
runHermesUpdate(): Promise<UpdateResult>
checkForUpdates(): Promise<UpdateInfo>
downloadUpdate(): Promise<void>
installUpdate(): Promise<void>
getAppVersion(): Promise<string>
onUpdateAvailable/DownloadProgress/Downloaded/Error(cb): () => void
```

### Configuration (Profile-Aware)
```typescript
getEnv(): Promise<Record<string, string>>
setEnv(env: Record<string, string>): Promise<void>
getConfig(key: string, profile?: string): Promise<any>
setConfig(key: string, value: any, profile?: string): Promise<void>
getHermesHome(): Promise<string>
getModelConfig(profile?: string): Promise<ModelConfig>
setModelConfig(provider, model, baseUrl, profile?): Promise<void>
getFullConfig(profile?: string): Promise<string>
saveFullConfig(yaml: string, profile?: string): Promise<void>
getConfigSchema(): Promise<ConfigSchema>
getConfigDefaults(): Promise<Record<string, any>>
getConfigRaw(profile?: string): Promise<string>
saveConfigRaw(yaml: string, profile?: string): Promise<void>
restartGatewayForConfig(): Promise<void>
```

### Connection Modes
```typescript
isRemoteMode(): Promise<boolean>
isRemoteOnlyMode(): Promise<boolean>
getConnectionConfig(): Promise<ConnectionConfig>
setConnectionConfig(config: ConnectionConfig): Promise<void>
setSshConfig(ssh: SshConfig): Promise<void>
testRemoteConnection(): Promise<{ success: boolean; error?: string }>
testSshConnection(): Promise<{ success: boolean; error?: string }>
isSshTunnelActive(): Promise<boolean>
startSshTunnel(): Promise<void>
stopSshTunnel(): Promise<void>
```

### Chat & Messages
```typescript
sendMessage(message, profile?, resumeSessionId?, history?, attachments?): Promise<void>
abortChat(): void
sendAudio(base64: string): Promise<TranscriptionResult>
getPathForFile(file: File): Promise<string>
stageAttachment(file: File, sessionId?: string): Promise<void>
clearStagedAttachments(sessionId?: string): Promise<void>
discoverProviderModels(provider, baseUrl, apiKey): Promise<Model[]>
```

### Chat Events (Callbacks)
```typescript
onChatChunk(cb: (chunk: string) => void): () => void
onChatDone(cb: (sessionId?: string) => void): () => void
onChatToolProgress(cb: (tool: string, status: string) => void): () => void
onChatUsage(cb: (usage: UsageState) => void): () => void
onChatError(cb: (error: string) => void): () => void
onTtsAudio(cb: (base64Chunk: string) => void): () => void
```

### Gateway
```typescript
startGateway(): Promise<GatewayResult>
stopGateway(): Promise<GatewayResult>
gatewayStatus(): Promise<GatewayStatus>
```

### Sessions
```typescript
listSessions(profile?: string): Promise<SessionSummary[]>
getSessionMessages(sessionId: string): Promise<ChatMessage[]>
listCachedSessions(): Promise<CachedSession[]>
syncSessionCache(): Promise<void>
updateSessionTitle(sessionId: string, title: string): Promise<void>
deleteSession(sessionId: string): Promise<void>
searchSessions(query: string): Promise<SessionSummary[]>
```

### Profiles
```typescript
listProfiles(): Promise<string[]>
createProfile(name: string): Promise<void>
deleteProfile(name: string): Promise<void>
setActiveProfile(name: string): Promise<void>
```

### Memory
```typescript
readMemory(): Promise<MemoryData>
addMemoryEntry(entry: MemoryEntry): Promise<void>
updateMemoryEntry(id: string, entry: Partial<MemoryEntry>): Promise<void>
removeMemoryEntry(id: string): Promise<void>
writeUserProfile(profile: UserProfile): Promise<void>
```

### Soul
```typescript
readSoul(): Promise<string>
writeSoul(content: string): Promise<void>
resetSoul(): Promise<void>
```

### Tools & Skills
```typescript
getToolsets(): Promise<ToolsetState[]>
setToolsetEnabled(name: string, enabled: boolean): Promise<void>
listInstalledSkills(): Promise<Skill[]>
listBundledSkills(): Promise<Skill[]>
getSkillContent(skillId: string): Promise<string>
installSkill(skillId: string): Promise<void>
uninstallSkill(skillId: string): Promise<void>
```

### Models
```typescript
listModels(): Promise<ModelEntry[]>
addModel(model: ModelEntry): Promise<void>
removeModel(id: string): Promise<void>
updateModel(id: string, model: Partial<ModelEntry>): Promise<void>
```

### Credentials
```typescript
getCredentialPool(): Promise<CredentialPool>
setCredentialPool(pool: CredentialPool): Promise<void>
```

### Platform Toggles
```typescript
getPlatformEnabled(platform: string): Promise<boolean>
setPlatformEnabled(platform: string, enabled: boolean): Promise<void>
```

### Cron Jobs
```typescript
listCronJobs(): Promise<CronJob[]>
createCronJob(job: CronJobInput): Promise<CronJob>
removeCronJob(id: string): Promise<void>
pauseCronJob(id: string): Promise<void>
resumeCronJob(id: string): Promise<void>
triggerCronJob(id: string): Promise<void>
```

### Kanban
```typescript
kanbanListBoards/CurrentBoard/SwitchBoard/CreateBoard/RemoveBoard(): Promise<...>
kanbanListTasks/GetTask/CreateTask(): Promise<...>
kanbanAssign/Complete/Block/Unblock/Archive/Specify/Reclaim/Comment/DispatchOnce(): Promise<...>
selectFolder(): Promise<string | null>
```

### Vault
```typescript
getStatus(): Promise<VaultStatus>
listBuckets(): Promise<Bucket[]>
browse(bucketId, path): Promise<FileEntry[]>
search(query, bucketId?): Promise<SearchResult[]>
createBucket/deleteBucket/updateBucket(...): Promise<...>
reindex(bucketId?): Promise<void>
tree(bucketId?): Promise<TreeNode>
readFile(bucketId, path): Promise<string>
writeFile(bucketId, path, content): Promise<void>
moveItem/bucketId, src, dst): Promise<void>
createFile/createFolder(bucketId, path): Promise<void>
deleteItem(bucketId, path): Promise<void>
getLinks(): Promise<Link[]>
```

### Plugins
```typescript
getPluginsHub(): Promise<PluginEntry[]>
installPlugin(id: string): Promise<void>
enablePlugin/disablePlugin(id: string): Promise<void>
updatePlugin(id: string): Promise<void>
removePlugin(id: string): Promise<void>
savePluginProviders(providers: ProviderConfig[]): Promise<void>
setPluginVisibility(id: string, visible: boolean): Promise<void>
```

### MCP & Memory Providers
```typescript
listMcpServers(): Promise<McpServer[]>
discoverMemoryProviders(): Promise<MemoryProvider[]>
```

### Logs
```typescript
readLogs(): Promise<string>
```

### Platform Info
```typescript
process.platform: string
versions: NodeJS.ProcessVersions
```

### Shell & Menu
```typescript
openExternal(url: string): Promise<void>
onMenuNewChat(cb: () => void): () => void
onMenuSearchSessions(cb: () => void): () => void
```

### Locale
```typescript
getLocale(): Promise<string>
setLocale(locale: string): Promise<void>
```

### Backup & Import
```typescript
runHermesBackup(): Promise<BackupResult>
runHermesImport(): Promise<ImportResult>
runHermesDump(): Promise<DumpResult>
```

### Claw3D (3D Environment)
```typescript
claw3dStatus(): Promise<Claw3dStatus>
claw3dSetup(): Promise<void>
onClaw3dSetupProgress(cb: (progress: Progress) => void): () => void
claw3dGetPort/SetPort/GetWsUrl/SetWsUrl(): Promise<...>
claw3dStartAll/StopAll(): Promise<void>
claw3dGetLogs(): Promise<string>
claw3dStartDev/StopDev(): Promise<void>
claw3dStartAdapter/StopAdapter(): Promise<void>
```

### Migration
```typescript
checkOpenClaw(): Promise<boolean>
runClawMigrate(): Promise<void>
```
