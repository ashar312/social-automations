async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* empty body */ }
  if (!res.ok || (data && data.ok === false)) {
    const err = new Error((data && (data.error || data.message)) || `Request failed (${res.status})`)
    err.data = data
    throw err
  }
  return data
}

export const api = {
  get: (u) => req('GET', u),
  post: (u, b) => req('POST', u, b ?? {}),
  del: (u) => req('DELETE', u),
}

// Upload with progress (fetch cannot report upload progress).
export function uploadMedia(file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media')
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(Math.round((e.loaded / e.total) * 100))
    xhr.onload = () => {
      let d = null
      try { d = JSON.parse(xhr.responseText) } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300 && d?.ok) resolve(d)
      else reject(new Error(d?.error || `Upload failed (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

export const PLATFORM_LABEL = { linkedin: 'LinkedIn', youtube: 'YouTube', facebook: 'Facebook', instagram: 'Instagram' }
export const PLATFORMS = Object.keys(PLATFORM_LABEL)
