import React, { useEffect, useState } from 'react'
import { Card, Form, Input, Button, message, Spin } from 'antd'

const API_BASE = 'http://localhost:3001'

export default function WdpConfig() {
  const [form]    = Form.useForm()
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)

  // 加载当前配置
  useEffect(() => {
    fetch(`${API_BASE}/api/config`)
      .then(r => r.json())
      .then(cfg => {
        form.setFieldsValue(cfg.wdp)
        setLoading(false)
      })
      .catch(() => {
        message.error('无法连接后端服务，请确认 server.js 已启动')
        setLoading(false)
      })
  }, [])

  const onSave = async (values) => {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/api/config/wdp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (data.ok) {
        message.success('保存成功')
      } else {
        message.error('保存失败')
      }
    } catch {
      message.error('请求失败，请检查后端服务')
    }
    setSaving(false)
  }

  return (
    <Spin spinning={loading}>
      <Card title="底图配置" style={{ maxWidth: 600 }}>
        <Form
          form={form}
          layout="vertical"
          onFinish={onSave}
        >
          <Form.Item
            label="51WORLD 云渲染链接"
            name="url"
            rules={[{ required: true, message: '请输入云渲染链接' }]}
          >
            <Input placeholder="https://dtp-api.51aes.com" />
          </Form.Item>

          <Form.Item
            label="渲染口令"
            name="order"
            rules={[{ required: true, message: '请输入渲染口令' }]}
          >
            <Input placeholder="32位渲染口令" />
          </Form.Item>

          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>
              保存
            </Button>
          </Form.Item>
        </Form>

        <div style={{ marginTop: 12, color: '#888', fontSize: 12 }}>
          保存后刷新主大屏页面（F5）即可生效。
        </div>
      </Card>
    </Spin>
  )
}
