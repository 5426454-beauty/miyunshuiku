import httpx, json, time

# 启动分析
resp = httpx.post(
    "http://localhost:8000/api/start",
    json={"target": "停车场", "lat": 39.9042, "lng": 116.4074, "zoom": 12}
)
print("start:", resp.json())
session_id = resp.json()["session_id"]

# 读取 SSE 流
import sys
with httpx.Client(timeout=60) as client:
    with client.stream("GET", f"http://localhost:8000/api/stream/{session_id}") as r:
        for line in r.iter_lines():
            if line.startswith("data: "):
                data = json.loads(line[6:])
                t = data.get("type")
                if t == "log":
                    print("LOG:", data["message"])
                elif t == "error":
                    print("ERROR:", data["message"])
                    break
                elif t == "screenshot":
                    print("SCREENSHOT received, length:", len(data.get("image", "")))
                elif t == "done":
                    print("DONE")
                    break
                else:
                    print("EVENT:", data)
                sys.stdout.flush()
