import type { Access, FieldAccess } from 'payload'

/** 已登录用户 */
export const isAuthed: Access = ({ req }) => Boolean(req.user)

/** 管理员 */
export const isAdmin: Access = ({ req }) => req.user?.role === 'admin'

/** 管理员或编辑 */
export const isAdminOrEditor: Access = ({ req }) => {
  const role = req.user?.role
  return role === 'admin' || role === 'editor'
}

/** 管理员全权 / editor 只能改自己创建的 */
export const isAdminOrOwner: Access = ({ req }) => {
  if (!req.user) return false
  if (req.user.role === 'admin') return true
  // editor / viewer 只能操作自己是 createdBy 的记录
  return { createdBy: { equals: req.user.id } }
}

export const isAdminFieldLevel: FieldAccess = ({ req }) => req.user?.role === 'admin'
