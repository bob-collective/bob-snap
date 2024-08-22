import { Psbt, opcodes, script } from 'bitcoinjs-lib';
import { AccountSigner } from './index';
import { BitcoinNetwork } from '../interface';
import { PsbtHelper } from '../bitcoin/PsbtHelper';
import { fromHdPathToObj } from './cryptoPath';
import { PsbtValidateErrors, SnapError } from "../errors";
import { isTaprootInput } from 'bitcoinjs-lib/src/psbt/bip371';
import { tapInputHasHDKey, tapOutputHasHDKey } from './tapSigner';

const BITCOIN_MAINNET_COIN_TYPE = 0;
const BITCOIN_TESTNET_COIN_TYPE = 1;
const BITCOIN_MAIN_NET_ADDRESS_PATTERN = /^(1|3|bc1)/;
const BITCOIN_TEST_NET_ADDRESS_PATTERN = /^(m|n|2|tb1)/;

function checkForInput<PsbtInput>(inputs: PsbtInput[], inputIndex: number): PsbtInput {
  const input = inputs[inputIndex];
  if (input === undefined) throw new Error(`No input #${inputIndex}`);
  return input;
}

export class PsbtValidator {
  static FEE_THRESHOLD = 10000000;
  private readonly psbt: Psbt;
  private readonly snapNetwork: BitcoinNetwork;
  private psbtHelper: PsbtHelper;
  private error: SnapError | null = null;

  constructor(psbt: Psbt, network: BitcoinNetwork) {
    this.psbt = psbt;
    this.snapNetwork = network;
    this.psbtHelper = new PsbtHelper(this.psbt, network);
  }

  get coinType() {
    return this.snapNetwork === BitcoinNetwork.Main ? BITCOIN_MAINNET_COIN_TYPE : BITCOIN_TESTNET_COIN_TYPE;
  }

  allInputsHaveRawTxHex() {
    const result = this.psbt.data.inputs.every((input, index) => !!input.nonWitnessUtxo);
    if (!result) {
      this.error = SnapError.of(PsbtValidateErrors.InputsDataInsufficient);
    }
    return result;
  }

  everyInputMatchesNetwork() {
    const result = this.psbt.data.inputs.every(input => {
      if (isTaprootInput(input)) {
        return input.tapBip32Derivation.every(derivation => {
          const { coinType } = fromHdPathToObj(derivation.path);
          return Number(coinType) === this.coinType;
        });
      } else {
        return input.bip32Derivation.every(derivation => {
          const { coinType } = fromHdPathToObj(derivation.path);
          return Number(coinType) === this.coinType;
        });
      }
    });
    if (!result) {
      this.error = SnapError.of(PsbtValidateErrors.InputsNetworkNotMatch);
    }
    return result;
  }

  everyOutputMatchesNetwork() {
    const addressPattern = this.snapNetwork === BitcoinNetwork.Main ? BITCOIN_MAIN_NET_ADDRESS_PATTERN : BITCOIN_TEST_NET_ADDRESS_PATTERN;
    const result = this.psbt.data.outputs.every((output, index) => {
      if (output.tapBip32Derivation) {
        return output.tapBip32Derivation.every(derivation => {
          const { coinType } = fromHdPathToObj(derivation.path)
          return Number(coinType) === this.coinType
        })
      } else if (output.bip32Derivation) {
        return output.bip32Derivation.every(derivation => {
          const { coinType } = fromHdPathToObj(derivation.path)
          return Number(coinType) === this.coinType
        })
      } else {
        const scriptPubKey = script.decompile(this.psbt.txOutputs[index].script);
        if (scriptPubKey.length == 2 && scriptPubKey[0] == opcodes.OP_RETURN && Buffer.isBuffer(scriptPubKey[1])) {
          if (scriptPubKey[1].byteLength > 80) {
            // miners will reject anything over 80 bytes
            this.error = SnapError.of(PsbtValidateErrors.InvalidOpReturn);
          }
          // as an exception we allow OP_RETURN outputs
          return true;
        }
        const address = this.psbt.txOutputs[index].address;
        return addressPattern.test(address);
      }
    })

    if (!result) {
      this.error = SnapError.of(PsbtValidateErrors.OutputsNetworkNotMatch);
    }
    return result;
  }

  allInputsBelongToCurrentAccount(accountSigner: AccountSigner) {
    const result = this.psbt.txInputs.every((_, index) => {
      const input = checkForInput(this.psbt.data.inputs, index);
      if (isTaprootInput(input)) {
        return tapInputHasHDKey(input, accountSigner);
      } else {
        return this.psbt.inputHasHDKey(index, accountSigner);
      }
    });
    if (!result) {
      this.error = SnapError.of(PsbtValidateErrors.InputNotSpendable);
    }
    return result;
  }

  changeAddressBelongsToCurrentAccount(accountSigner: AccountSigner) {
    const result = this.psbt.data.outputs.every((output, index) => {
      if (output.tapBip32Derivation) {
        return tapOutputHasHDKey(output, accountSigner);
      } else if (output.bip32Derivation) {
        return this.psbt.outputHasHDKey(index, accountSigner);
      }
      return true;
    });
    if (!result) {
      this.error = SnapError.of(PsbtValidateErrors.ChangeAddressInvalid);
    }
    return result;
  }

  feeUnderThreshold() {
    const result = this.psbtHelper.fee < PsbtValidator.FEE_THRESHOLD;
    if (!result) {
      this.error = SnapError.of(PsbtValidateErrors.FeeTooHigh);
    }
    return result;
  }

  witnessUtxoValueMatchesNoneWitnessOnes() {
    const hasWitnessUtxo = this.psbt.data.inputs.some((_, index) => this.psbt.getInputType(index) === "witnesspubkeyhash");
    if (!hasWitnessUtxo) {
      return true;
    }

    const witnessAmount = this.psbt.data.inputs.reduce((total, input, index) => {
      return total + input.witnessUtxo.value;
    }, 0);
    const result = this.psbtHelper.inputAmount === witnessAmount;

    if (!result) {
      this.error = SnapError.of(PsbtValidateErrors.AmountNotMatch);
    }
    return result;
  }

  validate(accountSigner: AccountSigner) {
    this.error = null;

    this.allInputsHaveRawTxHex() &&
      this.everyInputMatchesNetwork() &&
      this.everyOutputMatchesNetwork() &&
      this.allInputsBelongToCurrentAccount(accountSigner) &&
      this.changeAddressBelongsToCurrentAccount(accountSigner) &&
      this.feeUnderThreshold() &&
      this.witnessUtxoValueMatchesNoneWitnessOnes();

    if (this.error) {
      throw this.error
    }
    return true;
  }
}
