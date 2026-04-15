# 永久 VIP 支付接入说明

## 1. 云函数配置
编辑 `cloudfunctions/quickstartFunctions/vipPaymentConfig.js`：

- `env`：`0` 现网，`1` 沙箱
- `offerId`：小程序虚拟支付基础配置中的 `offerId`
- `appKey`：对应环境的 `AppKey`
- `appSecret`：小程序 `AppSecret`
- `productId`：虚拟支付后台发布的道具 `productId`
- `productCode`：本项目内部商品编码，默认 `lifetime_vip_99`
- `priceFen`：价格，默认 `9900`

## 2. 微信后台
- 小程序后台开通 `虚拟支付`
- 在虚拟支付后台创建并发布一个道具商品
- 商品价格配置为 `99 元`
- 商品 `productId` 与 `vipPaymentConfig.js` 保持一致

## 3. 真机联调
- 云函数上传 `quickstartFunctions`
- 先使用沙箱环境联调
- 在会员中心点击 `立即开通永久 VIP`
- 支付成功后确认：
  - `member_orders` 集合生成订单
  - `users` 集合的 `memberStatus` 变为 `vip`
  - 首页和详情页不再受每日 2 张限制

## 4. 回调与发货
- 当前云函数已经提供 `handleVirtualPaymentNotify` 和 `markVipDelivered`
- 若你后续接入 HTTP 网关，可将虚拟支付通知直接转发到这两个能力
- 当前客户端也会在支付完成后主动轮询查单并补发权益
