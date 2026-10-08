import { UserSettings } from '../types';
import { generateInviteEmailHtml, EmailInviteParams } from '../utils/email-template';

/**
 * Resend Email Service Client
 * Sends invitation emails automatically via the official Resend API (https://resend.com)
 */
export class ResendService {
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
    const fromAddress = settings.resendFromEmail?.trim() || 'Commyweb <onboarding@resend.dev>';
    const subject = `[Commyweb] ${params.invitedByName} vous invite à collaborer sur une page`;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [params.recipientEmail],
          subject: subject,
          html: html
        })
      });

      const data = await response.json();

      if (!response.ok) {
        return {
          success: false,
          error: data.message || `Erreur Resend (${response.status})`
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
