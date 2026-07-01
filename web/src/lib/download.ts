import { dump } from 'js-yaml'

/* eslint-disable @typescript-eslint/no-explicit-any */

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/yaml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

// Strips server-managed fields so the exported manifest is clean and re-appliable
// (no managedFields/status/resourceVersion/uid/last-applied-config noise).
export function cleanManifest(input: unknown): unknown {
  const o = structuredClone(input) as any
  if (o && typeof o === 'object') {
    if (o.metadata) {
      for (const k of ['managedFields', 'creationTimestamp', 'generation', 'resourceVersion', 'uid', 'selfLink']) {
        delete o.metadata[k]
      }
      if (o.metadata.annotations) {
        delete o.metadata.annotations['kubectl.kubernetes.io/last-applied-configuration']
        if (Object.keys(o.metadata.annotations).length === 0) delete o.metadata.annotations
      }
    }
    delete o.status
  }
  return o
}

export const toManifestYaml = (raw: unknown): string => dump(cleanManifest(raw))
