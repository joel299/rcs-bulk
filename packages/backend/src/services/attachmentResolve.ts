import fs from 'fs'
import path from 'path'

const IMAGE_EXT = /\.(jpe?g|png|gif|webp)$/i

function defaultAttachmentDir(): string {
  const env = process.env.ATTACHMENT_IMAGES_DIR?.trim()
  if (env) return path.resolve(env)
  return path.resolve(process.cwd(), '..', '..', 'envio-mesagens')
}

/**
 * Primeira imagem (ordem lexicográfica) em ATTACHMENT_IMAGES_DIR ou ../envio-mesagens relativo ao backend.
 */
export function pickFirstImageFromAttachmentDir(): string | null {
  const dir = defaultAttachmentDir()
  if (!fs.existsSync(dir)) {
    console.warn(`[attachmentResolve] Directory does not exist: ${dir}`)
    return null
  }
  const names = fs.readdirSync(dir).filter((n) => IMAGE_EXT.test(n)).sort()
  if (names.length === 0) {
    console.warn(`[attachmentResolve] No image files in: ${dir}`)
    return null
  }
  const full = path.join(dir, names[0])
  console.log(`[attachmentResolve] Using local image from dir: ${full}`)
  return full
}

/**
 * Campanha com imageUrl exige arquivo local: download ou pasta envio-mesagens.
 */
export function resolveMandatoryCampaignImage(
  imageUrl: string | undefined,
  downloadedPath: string | undefined
): string {
  if (!imageUrl?.trim()) {
    throw new Error('resolveMandatoryCampaignImage called without imageUrl')
  }
  if (downloadedPath && fs.existsSync(downloadedPath)) {
    return downloadedPath
  }
  const fallback = pickFirstImageFromAttachmentDir()
  if (fallback && fs.existsSync(fallback)) {
    return fallback
  }
  throw new Error(
    `Campaign requires image but no local file: download failed and no image in ${defaultAttachmentDir()}`
  )
}
