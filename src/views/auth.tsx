import type { User } from '../types'
import { Layout } from './layout'

function ErrorList(props: { errors: string[] }) {
  if (props.errors.length === 0) return <></>
  return (
    <div class="alert alert-error">
      {props.errors.map((error) => (
        <div>{error}</div>
      ))}
    </div>
  )
}

export function LoginPage(props: {
  user: User | null
  errors: string[]
  username?: string
  next?: string
  csrf: string
}) {
  return (
    <Layout title="登录 - Simple Forum" user={props.user} csrf={props.csrf}>
      <div class="card auth-card">
        <h1>登录</h1>
        <p class="auth-hint">登录后可发帖、回复并查看个人页。</p>
        <ErrorList errors={props.errors} />
        <form method="post" action="/login">
          <input type="hidden" name="_csrf" value={props.csrf} />
          {props.next ? <input type="hidden" name="next" value={props.next} /> : null}
          <div class="form-row">
            <label>用户名</label>
            <input type="text" name="username" value={props.username ?? ''} autocomplete="username" required />
          </div>
          <div class="form-row">
            <label>密码</label>
            <input type="password" name="password" autocomplete="current-password" required />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">登录</button>
            <span class="form-switch">
              还没有账号？<a href="/register">注册</a>
            </span>
          </div>
        </form>
      </div>
    </Layout>
  )
}

export function RegisterPage(props: {
  user: User | null
  errors: string[]
  username?: string
  next?: string
  csrf: string
}) {
  return (
    <Layout title="注册 - Simple Forum" user={props.user} csrf={props.csrf}>
      <div class="card auth-card">
        <h1>注册</h1>
        <p class="auth-hint">用户名 2-20 位（字母 / 数字 / 下划线，支持中文），密码至少 6 位。</p>
        <ErrorList errors={props.errors} />
        <form method="post" action="/register">
          <input type="hidden" name="_csrf" value={props.csrf} />
          {props.next ? <input type="hidden" name="next" value={props.next} /> : null}
          <div class="form-row">
            <label>用户名</label>
            <input type="text" name="username" value={props.username ?? ''} autocomplete="username" required />
          </div>
          <div class="form-row">
            <label>密码</label>
            <input type="password" name="password" autocomplete="new-password" required />
          </div>
          <div class="form-row">
            <label>确认密码</label>
            <input type="password" name="confirmPassword" autocomplete="new-password" required />
          </div>
          <div class="form-actions">
            <button class="btn btn-primary" type="submit">注册</button>
            <span class="form-switch">
              已有账号？<a href="/login">登录</a>
            </span>
          </div>
        </form>
      </div>
    </Layout>
  )
}
