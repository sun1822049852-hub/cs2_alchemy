function asString(value) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value);
}

function validatePassword(password) {
  const text = asString(password);
  if (!text) {
    return {ok: false, reason: "password_required", message: "密码不能为空"};
  }
  const length = [...text].length;
  if (length < 12) {
    return {ok: false, reason: "password_too_short", message: "密码至少需要12个字符"};
  }
  if (length > 128) {
    return {ok: false, reason: "password_too_long", message: "密码不能超过128个字符"};
  }
  return {ok: true, reason: "valid", message: ""};
}

function validateUsername(username) {
  const text = asString(username).trim();
  if (!text) {
    return {ok: false, reason: "username_required", message: "用户名不能为空"};
  }
  if (text.length < 3) {
    return {ok: false, reason: "username_too_short", message: "用户名至少需要3个字符"};
  }
  if (text.length > 20) {
    return {ok: false, reason: "username_too_long", message: "用户名不能超过20个字符"};
  }
  if (!/^[a-zA-Z0-9_]+$/.test(text)) {
    return {ok: false, reason: "username_invalid_chars", message: "用户名只能包含字母、数字和下划线"};
  }
  return {ok: true, reason: "valid", message: ""};
}

function validateEmail(email) {
  const text = asString(email).trim().toLowerCase();
  if (!text) {
    return {ok: false, reason: "email_required", message: "邮箱不能为空"};
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
    return {ok: false, reason: "email_invalid", message: "邮箱格式不正确"};
  }
  return {ok: true, reason: "valid", message: ""};
}

module.exports = {
  validatePassword,
  validateUsername,
  validateEmail
};
