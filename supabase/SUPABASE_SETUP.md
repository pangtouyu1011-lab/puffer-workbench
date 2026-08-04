# 共享房间 · Supabase 后端部署（推荐，国内可访问）

`*.workers.dev` 在大陆常被墙，所以共享房间改用了 **Supabase**（Postgres + REST API）。前端已支持两种后端：Supabase（默认）和 Cloudflare Workers。本说明只讲 Supabase。

## 一、注册并建项目（约 2 分钟）

1. 打开 https://supabase.com → 右上角 **Start your project** / **Sign Up**（用 GitHub 或邮箱都行）。
2. 登录后点 **New project**：
   - **Name**：随便填，如 `puffer-workbench`
   - **Database Password**：记一下（后面不用填进工作台，但别忘）
   - **Region**：选离你最近的，推荐 **Singapore (ap-southeast-1)**（国内访问最稳）
   - 点 **Create new project**，等 1 分钟左右建好。

## 二、建数据表（1 步）

1. 左侧菜单 → **SQL Editor** → **New query**
2. 把项目里 `supabase/rooms.sql` 的内容**整段粘进去**
3. 点右上角 **Run** → 看到 `Success` 即完成

> 这段 SQL 只建了一张 `rooms` 表，并关闭了行级安全（RLS），让前端的 anon key 能直接读写。
> 代价：知道「项目地址 + 表名 + 房间 ID + 口令」的人能读写——所以**房间 ID 和口令请当作秘密一样只和对方约定**。

## 三、拿到两个值，填进工作台

1. 左侧菜单 → **Project Settings**（齿轮图标）→ **API**
2. 复制这两样：
   - **Project URL**：形如 `https://xxxx.supabase.co`
   - **Project API keys → anon public key**：以 `eyJ...` 开头的一长串（这是**公开密钥**，可以安全填进前端，不用隐藏）

## 四、在工作台里开启共享

打开工作台右上角 ⚙️ 设置 → **🤝 共享房间（两人协作）**：

- 后端：选 **Supabase（推荐）**
- 项目 URL：贴上面的 `https://xxxx.supabase.co`
- Anon Key：贴上面的 anon public key
- 房间 ID：两人约定一个相同的字符串，比如 `pangtouyu`
- 访问口令：两人约定一个相同的口令
- 点 **🤝 加入房间**

对方也在同一台工作台（手机/PC 都行）填**完全相同**的 URL + Anon Key + 房间 ID + 口令，点加入，两人就实时同步了。

## 五、验证部署（可选）

拿到 Project URL 和 anon key 后，可以让我帮你**预填进工作台默认设置**，并测试杭州网络能否连上 Supabase。把这两样发给我即可（anon key 是公开的，可放心发）。

## 六、把工作台默认房间预填好（可选）

把你的 Project URL + anon key + 房间 ID 发给我，我可以把它们写进工作台的默认配置，你和对方就不用每次手填了。
