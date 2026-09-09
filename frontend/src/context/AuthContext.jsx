import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import api, { getTokens, setTokens, clearTokens } from '../services/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const fetchMe = useCallback(async () => {
    const { accessToken } = getTokens()
    if (!accessToken) {
      setLoading(false)
      return
    }
    try {
      const { data } = await api.get('/auth/me')
      setUser(data)
    } catch {
      clearTokens()
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMe()
  }, [fetchMe])

  async function login(email, password, rememberMe) {
    const { data } = await api.post('/auth/login', { email, password, remember_me: rememberMe })
    setTokens(data.access_token, data.refresh_token, rememberMe)
    await fetchMe()
  }

  async function register(payload) {
    await api.post('/auth/register', payload)
  }

  async function logout() {
    const { refreshToken } = getTokens()
    try {
      if (refreshToken) await api.post('/auth/logout', { refresh_token: refreshToken })
    } catch {
      // ignore network errors on logout
    }
    clearTokens()
    setUser(null)
  }

  function updateUserLocal(patch) {
    setUser((prev) => ({ ...prev, ...patch }))
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser: fetchMe, updateUserLocal }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
