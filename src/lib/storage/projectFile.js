import { normalizeProject, PROJECT_SCHEMA_VERSION } from '../projectModel'

const FILE_EXTENSION = '.metro-studio.json'

export function buildProjectFileName(projectName) {
  const safeName = (projectName || 'metro-studio-project').replace(/[<>:"/\\|?*]+/g, '_').trim()
  return `${safeName || 'metro-studio-project'}${FILE_EXTENSION}`
}

export function serializeProject(project) {
  const normalized = normalizeProject(project)
  return JSON.stringify(
    {
      ...normalized,
      projectVersion: normalized.projectVersion || PROJECT_SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
    },
    null,
    2,
  )
}

export function downloadProjectFile(project) {
  const payload = serializeProject(project)
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = buildProjectFileName(project.name)
  link.click()
  URL.revokeObjectURL(url)
}

export async function parseProjectFile(file) {
  const text = await file.text()
  const raw = JSON.parse(text)
  if (!raw || typeof raw !== 'object') {
    throw new Error('工程文件格式不正确')
  }
  if (!raw.projectVersion) {
    throw new Error('工程文件缺少 projectVersion')
  }
  return normalizeProject(raw)
}

