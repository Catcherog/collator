# TEMP: 调用lark-cli创建资源记录 | 2026-06-28 | 预计删除日期 2026-07-01
import subprocess
import json
import sys

# 读取准备好的JSON数据
with open("src/scripts/temp/create_record.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# 使用lark-cli执行API调用
# 通过stdin传递JSON数据避免PowerShell解析问题
api_path = "/open-apis/bitable/v1/apps/MwGMbF0Q0alPc6s3jOccovvOnob/tables/tblw4NagUnXw9yEw/records"

cmd = ["lark-cli", "api", "POST", api_path, "--data", "-", "--as", "user"]

proc = subprocess.Popen(
    cmd,
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    encoding="utf-8"
)

stdout, stderr = proc.communicate(input=json.dumps(data, ensure_ascii=False))

print("STDOUT:", stdout)
if stderr:
    print("STDERR:", stderr, file=sys.stderr)
print("Exit code:", proc.returncode)
