import asyncio, sys, traceback
sys.path.insert(0, '.')

async def main():
    try:
        import config as cfg
        print("config OK")
        print("ANTHROPIC_API_KEY:", cfg.ANTHROPIC_API_KEY[:12] + "..." if cfg.ANTHROPIC_API_KEY else "EMPTY")
        print("CLAUDE_MODEL:", cfg.CLAUDE_MODEL)

        import anthropic
        print("anthropic OK, version:", anthropic.__version__)

        client = anthropic.AsyncAnthropic(api_key=cfg.ANTHROPIC_API_KEY)
        print("client OK")

        from screenshot import MapScreenshotTaker
        print("screenshot OK")

        taker = MapScreenshotTaker()
        print("taker created, calling start()...")
        await taker.start()
        print("taker.start() OK")

        print("taking screenshot...")
        result = await taker.screenshot(39.9042, 116.4074, 12)
        print("screenshot OK, image length:", len(result['image']))
        print("bounds:", result['bounds'])

        await taker.stop()
        print("taker.stop() OK")

    except Exception as e:
        print("ERROR:", type(e).__name__, str(e))
        traceback.print_exc()

asyncio.run(main())
