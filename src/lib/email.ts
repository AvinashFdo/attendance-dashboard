type SendEmailInput = {
  to: string;
  subject: string;
  text: string;
};

type SendEmailResult =
  | { ok: true; status: "disabled"; resolvedTo: string | null }
  | { ok: true; status: "test_mode"; resolvedTo: string }
  | { ok: true; status: "sent"; resolvedTo: string }
  | { ok: false; status: "failed"; error: string };

function getEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function getEmailConfig() {
  const enabled = getEnv("EMAIL_ENABLED") === "true";
  const testMode = getEnv("EMAIL_TEST_MODE") === "true";
  const testRecipient = getEnv("EMAIL_TEST_RECIPIENT");
  const fromAddress = getEnv("EMAIL_FROM_ADDRESS");
  const fromName = getEnv("EMAIL_FROM_NAME") || "Attendance Monitoring";

  const tenantId = getEnv("MICROSOFT_TENANT_ID");
  const clientId = getEnv("MICROSOFT_CLIENT_ID");
  const clientSecret = getEnv("MICROSOFT_CLIENT_SECRET");

  return {
    enabled,
    testMode,
    testRecipient,
    fromAddress,
    fromName,
    tenantId,
    clientId,
    clientSecret,
  };
}

export function buildAttendanceAlertSubject() {
  return "Attendance Alert: Your attendance is below 70%";
}

export function buildAttendanceAlertBody(params: {
  studentName: string | null;
  moduleName: string;
  sessionCount: number;
  timePct: number;
}) {
  const name = params.studentName?.trim() || "Student";
  const pct = `${Math.round(params.timePct * 10) / 10}%`;

  return `
  <p>Dear ${name},</p>

  <p>
    We are writing to inform you that your attendance has fallen below the required threshold.
  </p>

  <p>
    Module: ${params.moduleName}<br/>
    Classes completed: ${params.sessionCount}<br/>
    Attendance (by time): ${pct}
  </p>

  <p>
    Please ensure that you attend all scheduled classes fully and regularly going forward.
  </p>

  <p>
    If there are any valid circumstances affecting your attendance, please contact your lecturer or the student support team as soon as possible.
  </p>

  <p>
    <strong>
      Please ensure that you attend sessions using your official student email address.
      Attendance recorded under personal email accounts are not counted.
    </strong>
  </p>

  <p>
    Regards,<br/>
    Attendance Monitoring
  </p>
  `;
}

async function getMicrosoftAccessToken() {
  const config = getEmailConfig();

  if (!config.tenantId || !config.clientId || !config.clientSecret) {
    throw new Error("Missing Microsoft Graph credentials in environment variables.");
  }

  const tokenUrl = `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: "https://graph.microsoft.com/.default",
    grant_type: "client_credentials",
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to get Microsoft access token: ${text}`);
  }

  const data = (await res.json()) as { access_token?: string };

  if (!data.access_token) {
    throw new Error("Microsoft access token missing in token response.");
  }

  return data.access_token;
}

async function sendViaMicrosoftGraph(input: {
  to: string;
  subject: string;
  text: string;
}) {
  const config = getEmailConfig();

  if (!config.fromAddress) {
    throw new Error("EMAIL_FROM_ADDRESS is missing.");
  }

  const accessToken = await getMicrosoftAccessToken();

  const graphUrl = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
    config.fromAddress
  )}/sendMail`;

  const payload = {
    message: {
      subject: input.subject,
      body: {
        contentType: "HTML",
        content: input.text,
      },
      toRecipients: [
        {
          emailAddress: {
            address: input.to,
          },
        },
      ],
      from: {
        emailAddress: {
          address: config.fromAddress,
          name: config.fromName,
        },
      },
    },
    saveToSentItems: true,
  };

  const res = await fetch(graphUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Microsoft Graph sendMail failed: ${text}`);
  }
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const config = getEmailConfig();

  console.log("[email-debug] raw env", {
  EMAIL_ENABLED: process.env.EMAIL_ENABLED,
  EMAIL_TEST_MODE: process.env.EMAIL_TEST_MODE,
  EMAIL_TEST_RECIPIENT: process.env.EMAIL_TEST_RECIPIENT,
  EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
});

console.log("[email-debug] parsed config", config);

  if (!config.enabled) {
    console.log("[email] disabled", {
      originalTo: input.to,
      subject: input.subject,
    });

    return {
      ok: true,
      status: "disabled",
      resolvedTo: null,
    };
  }

  const resolvedTo =
    config.testMode && config.testRecipient ? config.testRecipient : input.to;

  if (!resolvedTo) {
    return {
      ok: false,
      status: "failed",
      error: "No recipient resolved for email.",
    };
  }

  try {
    await sendViaMicrosoftGraph({
      to: resolvedTo,
      subject: input.subject,
      text: input.text,
    });

    return {
      ok: true,
      status: config.testMode ? "test_mode" : "sent",
      resolvedTo,
    };
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      error: error instanceof Error ? error.message : "Unknown email sending error",
    };
  }
}