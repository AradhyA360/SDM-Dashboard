import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

function getStore() {
  return localStorage.getItem('remember_me') === 'true' ? localStorage : sessionStorage
}

export function getTokens() {
  const store = getStore()
  return {
    accessToken: store.getItem('access_token'),
    refreshToken: store.getItem('refresh_token'),
  }
}

export function setTokens(accessToken, refreshToken, rememberMe) {
  if (rememberMe) localStorage.setItem('remember_me', 'true')
  const store = getStore()
  store.setItem('access_token', accessToken)
  store.setItem('refresh_token', refreshToken)
}

export function clearTokens() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('remember_me')
  sessionStorage.removeItem('access_token')
  sessionStorage.removeItem('refresh_token')
}

api.interceptors.request.use((config) => {
  const { accessToken } = getTokens()
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`
  return config
})

let isRefreshing = false
let queue = []

function processQueue(error, token = null) {
  queue.forEach(({ resolve, reject }) => (error ? reject(error) : resolve(token)))
  queue = []
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const originalRequest = error.config
    if (error.response?.status === 401 && !originalRequest._retry && !originalRequest.url.includes('/auth/')) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          queue.push({ resolve, reject })
        }).then((token) => {
          originalRequest.headers.Authorization = `Bearer ${token}`
          return api(originalRequest)
        })
      }
      originalRequest._retry = true
      isRefreshing = true
      const { refreshToken } = getTokens()
      try {
        if (!refreshToken) throw new Error('No refresh token')
        const rememberMe = localStorage.getItem('remember_me') === 'true'
        const resp = await axios.post('/api/auth/refresh', { refresh_token: refreshToken })
        const { access_token, refresh_token } = resp.data
        setTokens(access_token, refresh_token, rememberMe)
        processQueue(null, access_token)
        originalRequest.headers.Authorization = `Bearer ${access_token}`
        return api(originalRequest)
      } catch (refreshError) {
        processQueue(refreshError, null)
        clearTokens()
        window.location.href = '/login'
        return Promise.reject(refreshError)
      } finally {
        isRefreshing = false
      }
    }
    return Promise.reject(error)
  }
)

export default api
