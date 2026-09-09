export const ROLE_LABELS = {
  admin: 'Admin',
  sdm: 'SDM',
  associate: 'Associate',
}

export const ROLE_BADGE_STYLES = {
  admin: 'bg-brand-100 text-brand-700 dark:bg-brand-900/50 dark:text-brand-300',
  sdm: 'bg-teal-100 text-teal-700 dark:bg-teal-900/50 dark:text-teal-300',
  associate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
}

export function roleLabel(role) {
  return ROLE_LABELS[role] || role
}
