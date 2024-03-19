import { Snap } from '../interface';
import { getHDNode } from '../utils/getHDNode';
import bitcoinMessage from 'bitcoinjs-message';
import { RequestErrors, SnapError } from '../errors';
import { divider, heading, panel, text } from "@metamask/snaps-ui";

export async function signMessage(
  domain: string,
  snap: Snap,
  message: string,
  hdPath: string,
): Promise<string> {
  const result = await snap.request({
    method: 'snap_dialog',
    params: {
      type: 'confirmation',
      content: panel([
        heading('Sign Message'),
        text(`Please sign this message from ${domain}`),
        divider(),
        text(`${message}`),
      ]),
    },
  });

  if (result) {
    const privateKey = (await getHDNode(snap, hdPath)).privateKey;
    const signature = bitcoinMessage
      .sign(message, privateKey, true)
      .toString('hex');
    return signature;
  } else {
    throw SnapError.of(RequestErrors.RejectSign);
  }
}
