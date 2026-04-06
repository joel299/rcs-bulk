import { Client as MinioClient } from 'minio'
import { createHash } from 'crypto'
import path from 'path'

class StorageService {
  private client: MinioClient
  private bucket: string

  constructor() {
    this.bucket = process.env.MINIO_BUCKET ?? 'rcs-assets'
    this.client = new MinioClient({
      endPoint: process.env.MINIO_ENDPOINT ?? 'localhost',
      port: Number(process.env.MINIO_PORT ?? 9000),
      useSSL: process.env.MINIO_USE_SSL === 'true',
      accessKey: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
      secretKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
    })
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.bucket)
    if (!exists) {
      await this.client.makeBucket(this.bucket)
      // Política pública de leitura para as imagens de campanha
      const policy = JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { AWS: ['*'] },
            Action: ['s3:GetObject'],
            Resource: [`arn:aws:s3:::${this.bucket}/*`],
          },
        ],
      })
      await this.client.setBucketPolicy(this.bucket, policy)
    }
  }

  async upload(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    orgId: string
  ): Promise<string> {
    const hash = createHash('sha256').update(buffer).digest('hex').slice(0, 12)
    const ext = path.extname(originalName) || '.jpg'
    const objectName = `${orgId}/${hash}${ext}`

    await this.client.putObject(this.bucket, objectName, buffer, buffer.length, {
      'Content-Type': mimeType,
    })

    const endpoint = process.env.MINIO_ENDPOINT ?? 'localhost'
    const port = process.env.MINIO_PORT ?? '9000'
    const protocol = process.env.MINIO_USE_SSL === 'true' ? 'https' : 'http'

    return `${protocol}://${endpoint}:${port}/${this.bucket}/${objectName}`
  }

  /** Baixa imagem para /tmp e retorna o caminho local (para fileChooser do Playwright) */
  async downloadToTemp(imageUrl: string): Promise<string> {
    const url = new URL(imageUrl)
    const parts = url.pathname.split('/')
    const objectName = parts.slice(2).join('/')

    const hash = createHash('md5').update(imageUrl).digest('hex').slice(0, 8)
    const ext = path.extname(objectName) || '.jpg'
    const tmpPath = `/tmp/rcs-img-${hash}${ext}`

    await this.client.fGetObject(this.bucket, objectName, tmpPath)
    return tmpPath
  }
}

export const storageService = new StorageService()
