import { createId } from '../../../lib/ids'

export const annotationActions = {
  addAnnotation(lngLat, text = '') {
    if (!this.project || !Array.isArray(lngLat) || lngLat.length !== 2) return null
    if (!Array.isArray(this.project.annotations)) {
      this.project.annotations = []
    }

    const annotation = {
      id: createId('anno'),
      lngLat: [...lngLat],
      text: String(text || '').trim(),
      createdAt: Date.now(),
    }
    this.project.annotations.push(annotation)
    this.touchProject('新增注释')
    return annotation
  },

  updateAnnotationText(annotationId, text) {
    if (!this.project || !Array.isArray(this.project.annotations)) return false
    const annotation = this.project.annotations.find((a) => a.id === annotationId)
    if (!annotation) return false

    annotation.text = String(text || '').trim()
    this.touchProject('更新注释')
    return true
  },

  deleteAnnotation(annotationId) {
    if (!this.project || !Array.isArray(this.project.annotations)) return false
    const originalLength = this.project.annotations.length
    this.project.annotations = this.project.annotations.filter((a) => a.id !== annotationId)
    if (this.project.annotations.length === originalLength) return false

    this.touchProject('删除注释')
    return true
  },

  clearAnnotations() {
    if (!this.project) return false
    if (!this.project.annotations || this.project.annotations.length === 0) return false

    this.project.annotations = []
    this.touchProject('清空所有注释')
    return true
  },
}
