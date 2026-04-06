export interface User {
  id: string
  orgId: string
  email: string
  role: 'admin' | 'operator'
  createdAt: string
}

export interface Org {
  id: string
  name: string
  createdAt: string
}

export interface JwtPayload {
  sub: string
  orgId: string
  email: string
  role: 'admin' | 'operator'
}

export interface RegisterDto {
  orgName: string
  email: string
  password: string
}

export interface LoginDto {
  email: string
  password: string
}
