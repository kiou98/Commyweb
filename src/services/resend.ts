import { UserSettings } from '../types';
import { generateInviteEmailHtml, EmailInviteParams } from '../utils/email-template';

/**
 * Resend Email Service Client
 * Sends invitation emails automatically via the official Resend API (https://resend.com)
 */
export class ResendService {
  private static readonly PUBLIC_DOMAINS = [
    'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.fr',
    'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr',
    'live.com', 'icloud.com', 'free.fr', 'orange.fr', 'sfr.fr', 'wanadoo.fr'
  ];

  private static isPublicEmailDomain(email: string): boolean {
    const match = email.toLowerCase().match(/@([a-z0-9.-]+\.[a-z]{2,})/);
    if (!match) return false;
    const domain = match[1];
    return this.PUBLIC_DOMAINS.some(pub => domain === pub || domain.endsWith('.' + pub));
  }

  /**
   * Send an invitation email using Resend API
   */
  static async sendInviteEmail(
    settings: UserSettings,
    params: EmailInviteParams
  ): Promise<{ success: boolean; id?: string; error?: string }> {
    const apiKey = settings.resendApiKey?.trim();
    if (!apiKey) {
      return {
        success: false,
        error: 'NO_API_KEY'
      };
    }

    const html = generateInviteEmailHtml(params);
    const rawFrom = settings.resendFromEmail?.trim() || '';

    // If user provided a public email (like @gmail.com) as the FROM address,
    // Resend will reject it because public domains cannot be verified for sending.
    // Instead, fallback safely to Resend's authorized testing address 'onboarding@resend.dev'
    // and set the user's email as the 'reply_to' address so replies go directly to them!
    let fromAddress = 'Commyweb <onboarding@resend.dev>';
    let replyToAddress: string | undefined = undefined;

    if (rawFrom) {
      if (this.isPublicEmailDomain(rawFrom)) {
        fromAddress = 'Commyweb <onboarding@resend.dev>';
        replyToAddress = rawFrom;
      } else {
        fromAddress = rawFrom;
      }
    }

    const subject = `[Commyweb] ${params.invitedByName} vous invite à collaborer sur une page`;

    const requestBody: any = {
      from: fromAddress,
      to: [params.recipientEmail],
      subject: subject,
      html: html
    };

    if (replyToAddress) {
      requestBody.reply_to = replyToAddress;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      const data = await response.json();

      if (!response.ok) {
        let errorMsg = data.message || `Erreur Resend (${response.status})`;

        // Provide user-friendly guidance for common Resend configuration errors
        if (errorMsg.includes('domain is not verified')) {
          errorMsg = 'Les adresses publiques (@gmail.com, @yahoo, etc.) ne peuvent pas être utilisées comme expéditeur. Laissez le champ vide pour utiliser l\'adresse par défaut ou vérifiez votre propre domaine sur resend.com/domains.';
        } else if (errorMsg.includes('testing emails to your own email address')) {
          errorMsg = 'Compte Resend en mode test : sans domaine vérifié sur resend.com/domains, vous ne pouvez envoyer qu\'à l\'email de votre compte Resend. Ajoutez un domaine pour envoyer à n\'importe quel destinataire.';
        }

        return {
          success: false,
          error: errorMsg
        };
      }

      return {
        success: true,
        id: data.id
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Erreur réseau lors de l\'envoi via Resend'
      };
    }
  }
}
