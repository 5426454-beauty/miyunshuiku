import React, { useEffect, useState } from 'react'
import {
  Card, Table, Button, Modal, Form, Input, Select, Popconfirm, message, Space, Spin
} from 'antd'
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons'

const API_BASE = 'http://localhost:3001'
const METHODS  = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']

export default function ApiList() {
  const [apis,    setApis]    = useState([])
  const [loading, setLoading] = useState(true)
  const [open,    setOpen]    = useState(false)
  const [saving,  setSaving]  = useState(false)
  const [form]                = Form.useForm()

  const fetchApis = () => {
    fetch(`${API_BASE}/api/config/apis`)
      .then(r => r.json())
      .then(data => {
        setApis(data)
        setLoading(false)
      })
      .catch(() => {
        message.error('无法连接后端服务')
        setLoading(false)
      })
  }

  useEffect(() => { fetchApis() }, [])

  const handleAdd = async (values) => {
    setSaving(true)
    try {
      await fetch(`${API_BASE}/api/config/apis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      message.success('添加成功')
      setOpen(false)
      form.resetFields()
      fetchApis()
    } catch {
      message.error('添加失败')
    }
    setSaving(false)
  }

  const handleDelete = async (index) => {
    try {
      await fetch(`${API_BASE}/api/config/apis/${index}`, { method: 'DELETE' })
      message.success('已删除')
      fetchApis()
    } catch {
      message.error('删除失败')
    }
  }

  const columns = [
    { title: '名称',   dataIndex: 'name',   key: 'name' },
    { title: '方法',   dataIndex: 'method', key: 'method', width: 90 },
    { title: 'URL',    dataIndex: 'url',    key: 'url', ellipsis: true },
    {
      title: '操作',
      key: 'action',
      width: 80,
      render: (_, __, index) => (
        <Popconfirm
          title="确认删除？"
          onConfirm={() => handleDelete(index)}
          okText="删除"
          cancelText="取消"
        >
          <Button danger icon={<DeleteOutlined />} size="small" />
        </Popconfirm>
      ),
    },
  ]

  return (
    <Spin spinning={loading}>
      <Card
        title="自定义 API 列表"
        extra={
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOpen(true)}
          >
            添加
          </Button>
        }
      >
        <Table
          dataSource={apis}
          columns={columns}
          rowKey={(_, i) => i}
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无自定义 API，点击右上角添加' }}
        />
      </Card>

      <Modal
        title="添加自定义 API"
        open={open}
        onCancel={() => { setOpen(false); form.resetFields() }}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleAdd}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入名称' }]}
          >
            <Input placeholder="如：获取水位数据" />
          </Form.Item>

          <Form.Item
            label="方法"
            name="method"
            initialValue="GET"
            rules={[{ required: true }]}
          >
            <Select options={METHODS.map(m => ({ value: m, label: m }))} />
          </Form.Item>

          <Form.Item
            label="URL"
            name="url"
            rules={[{ required: true, message: '请输入 URL' }]}
          >
            <Input placeholder="https://example.com/api/water-level" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => { setOpen(false); form.resetFields() }}>取消</Button>
              <Button type="primary" htmlType="submit" loading={saving}>确认添加</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  )
}
