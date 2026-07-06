import React, { useState } from 'react'
import { Layout, Menu, Typography } from 'antd'
import {
  SettingOutlined,
  AppstoreOutlined,
  ApiOutlined,
} from '@ant-design/icons'
import WdpConfig   from './pages/WdpConfig'
import PanelConfig from './pages/PanelConfig'
import ApiList     from './pages/ApiList'

const { Sider, Header, Content } = Layout
const { Title } = Typography

const PAGES = {
  wdp:    <WdpConfig />,
  panels: <PanelConfig />,
  apis:   <ApiList />,
}

const MENU_ITEMS = [
  { key: 'wdp',    icon: <SettingOutlined />,   label: 'WDP 底图配置' },
  { key: 'panels', icon: <AppstoreOutlined />,  label: '面板配置' },
  { key: 'apis',   icon: <ApiOutlined />,        label: '自定义 API' },
]

export default function App() {
  const [current, setCurrent] = useState('wdp')

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider width={220} style={{ background: '#001529' }}>
        {/* Logo 区 */}
        <div style={{
          height: 64,
          display: 'flex',
          alignItems: 'center',
          padding: '0 24px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        }}>
          <span style={{ color: '#00d4ff', fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>
            ◈ 后台管理
          </span>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[current]}
          onClick={({ key }) => setCurrent(key)}
          items={MENU_ITEMS}
          style={{ marginTop: 8 }}
        />
      </Sider>

      <Layout>
        <Header style={{
          background: '#fff',
          padding: '0 24px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
        }}>
          <Title level={5} style={{ margin: 0, color: '#333' }}>
            数字孪生现代化水库矩阵管理 · 后台配置
          </Title>
        </Header>

        <Content style={{ padding: 24, background: '#f5f7fa', minHeight: 'calc(100vh - 64px)' }}>
          {PAGES[current]}
        </Content>
      </Layout>
    </Layout>
  )
}
