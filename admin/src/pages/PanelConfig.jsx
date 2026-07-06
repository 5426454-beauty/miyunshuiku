import React, { useEffect, useState } from 'react'
import {
  Tabs, Card, Form, Input, InputNumber, Slider, Table,
  Button, Modal, Select, Popconfirm, message, Spin, Space, Row, Col,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons'

const API_BASE    = 'http://localhost:3001'
const CHART_TYPES = [
  { value: 'line', label: '折线图' },
  { value: 'bar',  label: '柱状图' },
  { value: 'list', label: '列表' },
]

// 单侧面板配置组件
function SideConfig({ side, label }) {
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [modules,  setModules]  = useState([])
  const [style,    setStyle]    = useState({ width: '280px', bgColor: '#060e1f', opacity: 1 })
  const [apis,     setApis]     = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editIndex, setEditIndex] = useState(null) // null = 新增
  const [styleForm]  = Form.useForm()
  const [moduleForm] = Form.useForm()

  // 加载配置 + API 列表
  useEffect(() => {
    Promise.all([
      fetch(`${API_BASE}/api/config`).then(r => r.json()),
      fetch(`${API_BASE}/api/config/apis`).then(r => r.json()),
    ]).then(([cfg, apiList]) => {
      const panelCfg = cfg.panels[side]
      setStyle(panelCfg.style || {})
      setModules(panelCfg.modules || [])
      setApis(apiList)
      styleForm.setFieldsValue({
        width:   parseInt(panelCfg.style?.width) || 280,
        bgColor: panelCfg.style?.bgColor || '#060e1f',
        opacity: Math.round((panelCfg.style?.opacity ?? 1) * 100),
      })
      setLoading(false)
    }).catch(() => {
      message.error('无法连接后端服务')
      setLoading(false)
    })
  }, [side])

  // 保存样式
  const saveStyle = async (values) => {
    setSaving(true)
    const newStyle = {
      width:   `${values.width}px`,
      bgColor: values.bgColor,
      opacity: values.opacity / 100,
    }
    try {
      await fetch(`${API_BASE}/api/config/panels`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [side]: { style: newStyle, modules } }),
      })
      setStyle(newStyle)
      message.success('样式已保存')
    } catch {
      message.error('保存失败')
    }
    setSaving(false)
  }

  // 保存模块列表
  const saveModules = async (newModules) => {
    await fetch(`${API_BASE}/api/config/panels`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [side]: { style, modules: newModules } }),
    })
    setModules(newModules)
  }

  // 打开新增弹窗
  const openAdd = () => {
    setEditIndex(null)
    moduleForm.resetFields()
    moduleForm.setFieldsValue({ chartType: 'line' })
    setModalOpen(true)
  }

  // 打开编辑弹窗
  const openEdit = (index) => {
    setEditIndex(index)
    moduleForm.setFieldsValue(modules[index])
    setModalOpen(true)
  }

  // 提交模块表单
  const submitModule = async (values) => {
    const mod = {
      id: editIndex !== null ? modules[editIndex].id : `${side}-mod-${Date.now()}`,
      ...values,
    }
    const next = editIndex !== null
      ? modules.map((m, i) => i === editIndex ? mod : m)
      : [...modules, mod]
    try {
      await saveModules(next)
      message.success(editIndex !== null ? '已更新' : '已添加')
      setModalOpen(false)
    } catch {
      message.error('保存失败')
    }
  }

  // 删除模块
  const deleteModule = async (index) => {
    const next = modules.filter((_, i) => i !== index)
    try {
      await saveModules(next)
      message.success('已删除')
    } catch {
      message.error('删除失败')
    }
  }

  const columns = [
    { title: '标题',    dataIndex: 'title',        key: 'title' },
    { title: '图表类型', dataIndex: 'chartType',    key: 'chartType',
      render: v => CHART_TYPES.find(t => t.value === v)?.label || v },
    { title: '数据源',  dataIndex: 'dataSourceId', key: 'dataSourceId',
      render: v => v || <span style={{ color: '#999' }}>未配置（用 fallback）</span> },
    {
      title: '操作', key: 'action', width: 100,
      render: (_, __, index) => (
        <Space>
          <Button icon={<EditOutlined />} size="small" onClick={() => openEdit(index)} />
          <Popconfirm title="确认删除？" onConfirm={() => deleteModule(index)} okText="删除" cancelText="取消">
            <Button danger icon={<DeleteOutlined />} size="small" />
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <Spin spinning={loading}>
      {/* 样式配置 */}
      <Card title="面板全局样式" style={{ marginBottom: 16 }}>
        <Form form={styleForm} layout="inline" onFinish={saveStyle}>
          <Form.Item label="宽度 (px)" name="width" rules={[{ required: true }]}>
            <InputNumber min={160} max={600} style={{ width: 100 }} />
          </Form.Item>
          <Form.Item label="背景色 (Hex)" name="bgColor" rules={[{ required: true }]}>
            <Input style={{ width: 120 }} placeholder="#060e1f" />
          </Form.Item>
          <Form.Item label="透明度 (%)" name="opacity">
            <InputNumber min={0} max={100} style={{ width: 80 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={saving}>保存样式</Button>
          </Form.Item>
        </Form>
      </Card>

      {/* 图表模块列表 */}
      <Card
        title="图表模块"
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>添加模块</Button>}
      >
        <Table
          dataSource={modules}
          columns={columns}
          rowKey="id"
          pagination={false}
          size="small"
          locale={{ emptyText: '暂无模块，点击右上角添加' }}
        />
      </Card>

      {/* 模块编辑弹窗 */}
      <Modal
        title={editIndex !== null ? '编辑模块' : '添加模块'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={moduleForm} layout="vertical" onFinish={submitModule}>
          <Form.Item label="模块标题" name="title" rules={[{ required: true, message: '请输入标题' }]}>
            <Input placeholder="如：库容曲线" />
          </Form.Item>

          <Form.Item label="图表类型" name="chartType" rules={[{ required: true }]}>
            <Select options={CHART_TYPES} />
          </Form.Item>

          <Form.Item label="数据源" name="dataSourceId">
            <Select
              allowClear
              placeholder="选择已配置的 API（留空使用 fallback 数据）"
              options={apis.map(a => ({ value: a.name, label: `${a.name} [${a.method}]` }))}
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">确认</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </Spin>
  )
}

// 主页面：左/右两个 Tab
export default function PanelConfig() {
  return (
    <Tabs
      defaultActiveKey="left"
      items={[
        { key: 'left',  label: '左侧面板配置', children: <SideConfig side="left"  label="左侧" /> },
        { key: 'right', label: '右侧面板配置', children: <SideConfig side="right" label="右侧" /> },
      ]}
    />
  )
}
