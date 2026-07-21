# Requires FEISHU_BASE_APP_TOKEN environment variable.
# Fails closed if missing; never echoes the value.
if (-not $env:FEISHU_BASE_APP_TOKEN) {
  throw "FEISHU_BASE_APP_TOKEN is required"
}
lark-cli base +table-list --base-token $env:FEISHU_BASE_APP_TOKEN --as user
