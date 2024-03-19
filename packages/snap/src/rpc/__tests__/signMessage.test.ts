import { signMessage } from '../signMessage';
import { SnapMock } from '../__mocks__/snap';
import { bip44, MessageAndSig } from "./fixtures/bitcoinNode";

describe('signLNInvoice', () => {
  const snapStub = new SnapMock();

  afterEach(() => {
    snapStub.reset()
  })

  it('should return signature for message', async () => {
    snapStub.rpcStubs.snap_dialog.mockResolvedValue(true);
    snapStub.rpcStubs.snap_getBip32Entropy.mockResolvedValue(bip44.slip10Node);
    const signature = await signMessage(MessageAndSig.domain, snapStub, MessageAndSig.message, MessageAndSig.hdPath);
    expect(signature).toBe(MessageAndSig.signature);
  })

  it('should reject the sign request and throw error if user reject the sign the lightning invoice', async () => {
    snapStub.rpcStubs.snap_dialog.mockResolvedValue(false);

    await expect(signMessage(MessageAndSig.domain, snapStub, MessageAndSig.message, MessageAndSig.hdPath))
      .rejects
      .toThrowError('User reject the sign request');
  })
});
