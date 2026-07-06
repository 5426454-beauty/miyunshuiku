# Git 工作流程速查

## 每次打开项目的流程

### 第一步：确认你在哪个分支
```powershell
git branch
```
看到 `*` 在哪，你就在哪。

### 第二步：如果想开新分支
```powershell
git checkout master                        # 回到主线
git checkout -b feature/你的功能名称        # 从主线开新分支
```

### 第三步：改代码，改完就存档
```powershell
git add .
git commit -m "描述你改了什么"
```
**建议：每改完一个小功能就存一次档，别等全部改完。**

### 第四步：全部改完，合并回主线
```powershell
git checkout master                        # 切回主线
git merge feature/你的功能名称              # 把分支的改动合进来
```

### 第五步（可选）：删掉已完成的分支
```powershell
git branch -d feature/你的功能名称
```

---

## 常见场景

| 场景 | 操作 |
|------|------|
| 想知道当前在哪 | `git branch` |
| 想知道改了什么还没存 | `git status` |
| 想回到主线看看原始版本 | `git checkout master` |
| 想回到分支继续改 | `git checkout feature/你的功能名称` |
| 改坏了想恢复上次存档 | `git checkout .`（撤销所有未存档的改动） |
| 想放弃整个分支从头来 | `git checkout master` → `git checkout -b feature/新分支名` |

---

## 核心原则

> **主线永远干净，分支随便折腾。坏了就扔掉重来，主线毫发无损。**