import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth'
import { storageService } from '../services/StorageService'

export const assetsRouter = Router()
assetsRouter.use(requireAuth)

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) {
      cb(null, true)
    } else {
      cb(new Error('Only JPG, PNG and WebP images are allowed'))
    }
  },
})

assetsRouter.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' })
    return
  }

  const url = await storageService.upload(
    req.file.buffer,
    req.file.originalname,
    req.file.mimetype,
    req.user.orgId
  )

  res.json({ url })
})
