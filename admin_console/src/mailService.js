const {asString} = require("../../node_sidecar/src/utils");

function buildFrom(config) {
  const fromName = asString(config.fromName).trim();
  const fromAddress = asString(config.fromAddress).trim();
  if (!fromName) {
    return fromAddress;
  }
  return `${fromName} <${fromAddress}>`;
}

function buildVerificationMessage({scene = "", code = "", ttlMinutes = 5} = {}) {
  const sceneText = asString(scene).trim();
  const title = sceneText === "reset_password" ? "密码重置验证码" : "注册验证码";
  const action = sceneText === "reset_password" ? "重置密码" : "完成注册";
  const codeText = asString(code).trim();
  return {
    subject: `CS2 Tools ${title}`,
    text:
      `你的${title}为：${codeText}\n` +
      `有效期：${ttlMinutes} 分钟\n` +
      `用途：${action}\n` +
      "若非本人操作，请忽略此邮件。"
  };
}

function createMailService({config = {}, transport = null, transportFactory = null} = {}) {
  const mailConfig = config && typeof config === "object" ? config : {};
  const resolvedTransport = transport
    || (typeof transportFactory === "function" ? transportFactory(mailConfig) : null)
    || (() => {
      const nodemailer = require("nodemailer");
      return nodemailer.createTransport({
        host: mailConfig.smtpHost,
        port: mailConfig.smtpPort,
        secure: !!mailConfig.smtpSecure,
        auth: {
          user: mailConfig.smtpUser,
          pass: mailConfig.smtpPass
        }
      });
    })();

  return {
    getCapabilities() {
      return {
        configured: !!mailConfig.configured,
        provider: asString(mailConfig.provider).trim() || "qq",
        fromAddress: asString(mailConfig.fromAddress).trim()
      };
    },
    async sendVerificationCode({to = "", code = "", scene = "", ttlMinutes = mailConfig.authCodeTtlMinutes} = {}) {
      const message = buildVerificationMessage({scene, code, ttlMinutes});
      return resolvedTransport.sendMail({
        from: buildFrom(mailConfig),
        to: asString(to).trim(),
        subject: message.subject,
        text: message.text
      });
    },
    async sendTestMail({to = ""} = {}) {
      return resolvedTransport.sendMail({
        from: buildFrom(mailConfig),
        to: asString(to).trim(),
        subject: "CS2 Tools 邮件链路测试",
        text:
          "这是一封来自 CS2 Tools 认证服务的测试邮件。\n" +
          "如果你收到这封邮件，说明 QQ SMTP 配置已可用。"
      });
    }
  };
}

module.exports = {
  createMailService
};
