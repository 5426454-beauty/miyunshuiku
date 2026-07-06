import asyncio, sys, traceback, base64
sys.path.insert(0, '.')

async def main():
    try:
        import config as cfg
        import anthropic
        from screenshot import MapScreenshotTaker

        taker = MapScreenshotTaker()
        await taker.start()
        result = await taker.screenshot(39.9042, 116.4074, 12)
        img_b64 = result['image']
        bounds  = result['bounds']
        await taker.stop()
        print("截图成功，开始调用模型...")

        client = anthropic.AsyncAnthropic(api_key=cfg.ANTHROPIC_API_KEY)
        msg = await client.messages.create(
            model=cfg.CLAUDE_MODEL,
            max_tokens=512,
            thinking={"type": "adaptive"},
            system=[{"type": "text", "text": "你是地图分析助手", "cache_control": {"type": "ephemeral"}}],
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "描述这张卫星图（一句话）"},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": img_b64}},
                ]
            }],
        )
        print("模型调用成功！")
        for block in msg.content:
            if block.type == "text":
                print("回复:", block.text)

    except Exception as e:
        print("ERROR:", type(e).__name__, str(e))
        traceback.print_exc()

asyncio.run(main())
