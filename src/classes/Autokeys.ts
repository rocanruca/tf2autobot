import Bot from './Bot';
import { EntryData } from './Pricelist';
import moment from 'moment-timezone';

import Currencies from 'tf2-currencies';
import MyHandler from './MyHandler';

import log from '../lib/logger';
import DiscordWebhook from './DiscordWebhook';

export class Autokeys {
    private readonly bot: Bot;

    private readonly discord: DiscordWebhook;

    isEnabled = false;

    isKeyBankingEnabled = false;

    isActive = false;

    userPure: {
        minKeys: number;
        maxKeys: number;
        minRefs: number;
        maxRefs: number;
    };

    status = {
        isBuyingKeys: false,
        isBankingKeys: false,
        checkAlertOnLowPure: false,
        alreadyUpdatedToBank: false,
        alreadyUpdatedToBuy: false,
        alreadyUpdatedToSell: false
    };

    oldAmount = {
        keysCanBuy: 0,
        keysCanSell: 0,
        keysCanBankMin: 0,
        keysCanBankMax: 0,
        ofKeys: 0
    };

    isEnableScrapAdjustment = false;

    scrapAdjustmentValue = 0;

    private OldKeyPrices: { buy: Currencies; sell: Currencies };

    constructor(bot: Bot) {
        this.bot = bot;
        this.discord = new DiscordWebhook(bot);

        this.userPure = {
            minKeys: parseInt(process.env.MINIMUM_KEYS),
            maxKeys: parseInt(process.env.MAXIMUM_KEYS),
            minRefs: Currencies.toScrap(parseInt(process.env.MINIMUM_REFINED_TO_START_SELL_KEYS)),
            maxRefs: Currencies.toScrap(parseInt(process.env.MAXIMUM_REFINED_TO_STOP_SELL_KEYS))
        };

        const scrapValue = parseInt(process.env.SCRAP_ADJUSTMENT_VALUE);

        if (!scrapValue || isNaN(scrapValue)) {
            log.warn('Scrap adjustment not set or not a number, resetting to 0.');
            this.scrapAdjustmentValue = 0;
        } else {
            this.scrapAdjustmentValue = scrapValue;
        }

        if (process.env.DISABLE_SCRAP_ADJUSTMENT !== 'true') {
            this.isEnableScrapAdjustment = true;
        }

        if (process.env.ENABLE_AUTO_SELL_AND_BUY_KEYS === 'true' || process.env.ENABLE_AUTOKEYS === 'true') {
            this.isEnabled = true;
        }

        if (process.env.ENABLE_AUTO_KEY_BANKING === 'true' || process.env.ENABLE_AUTOKEYS_BANKING === 'true') {
            this.isKeyBankingEnabled = true;
        }
    }

    check(): void {
        if (this.isEnabled === false) {
            return;
        }

        const pure = (this.bot.handler as MyHandler).currPure();
        const currKeys = pure.key;
        const currRef = pure.refTotalInScrap;

        const userPure = this.userPure;

        const userMinKeys = userPure.minKeys;
        const userMaxKeys = userPure.maxKeys;
        const userMinRef = userPure.minRefs;
        const userMaxRef = userPure.maxRefs;

        if (isNaN(userMinKeys) || isNaN(userMinRef) || isNaN(userMaxRef)) {
            log.warn(
                "You've entered a non-number on either your MINIMUM_KEYS/MINIMUM_REFINED/MAXIMUM_REFINED variables, please correct it. Autokeys is disabled until you correct it."
            );
            return;
        }

        const currKeyPrice = this.bot.pricelist.getKeyPrices();

        if (currKeyPrice !== this.OldKeyPrices && this.isEnableScrapAdjustment) {
            // When scrap adjustment activated, if key rate changes, then it will force update key prices after a trade.
            this.status = {
                isBuyingKeys: false,
                isBankingKeys: false,
                checkAlertOnLowPure: false,
                alreadyUpdatedToBank: false,
                alreadyUpdatedToBuy: false,
                alreadyUpdatedToSell: false
            };
            this.OldKeyPrices = { buy: currKeyPrice.buy, sell: currKeyPrice.sell };
        }

        /**
         * enable Autokeys - Buying - true if currRef \> maxRef AND currKeys \< maxKeys
         */
        const isBuyingKeys = currRef > userMaxRef && currKeys < userMaxKeys;
        /*
        //        <——————————————————————————————————○            \
        // Keys --------|----------------------------|---------->  ⟩ AND
        //                                           ○——————>     /
        // Refs --------|----------------------------|---------->
        //             min                          max
        */

        /**
         * enable Autokeys - Selling - true if currRef \< minRef AND currKeys \> minKeys
         */
        const isSellingKeys = currRef < userMinRef && currKeys > userMinKeys;
        /*
        //              ○———————————————————————————————————>     \
        // Keys --------|----------------------------|---------->  ⟩ AND
        //        <—————○                                         /
        // Refs --------|----------------------------|---------->
        //             min                          max
        */

        /**
         * disable Autokeys - true if currRef \>= maxRef AND currKeys \>= maxKeys OR
         * (minRef \<= currRef \<= maxRef AND currKeys \<= maxKeys)
         */
        const isRemoveAutoKeys =
            (currRef >= userMaxRef && currKeys >= userMaxKeys) ||
            (currRef >= userMinRef && currRef <= userMaxRef && currKeys <= userMaxKeys);
        /*
        //        <——————————————————————————————————●·····>      \
        // Keys --------|----------------------------|---------->  ⟩ AND
        //              ●————————————————————————————●·····>      /
        // Refs --------|----------------------------|---------->
        //             min                          max
        */

        /**
         * enable Autokeys - Banking - true if user set ENABLE_AUTO_KEY_BANKING to true
         */
        const isEnableKeyBanking = this.isKeyBankingEnabled;

        /**
         * enable Autokeys - Banking - true if minRef \< currRef \< maxRef AND currKeys \> minKeys
         */
        const isBankingKeys = currRef > userMinRef && currRef < userMaxRef && currKeys > userMinKeys;
        /*
        //              ○———————————————————————————————————>     \
        // Keys --------|----------------------------|---------->  ⟩ AND
        //              ○————————————————————————————○            /
        // Refs --------|----------------------------|---------->
        //             min                          max
        */

        /**
         * enable Autokeys - Banking - true if minRef \> currRef \< maxRef AND keys \< minKeys
         * Will buy keys.
         */
        const isBankingBuyKeysWithEnoughRefs = currRef > userMinRef && currKeys <= userMinKeys;
        /*
        //        <—————●                                         \
        // Keys --------|----------------------------|---------->  ⟩ AND
        //              ○———————————————————————————————————>     /
        // Refs --------|----------------------------|---------->
        //             min                          max
        */

        /**
         * disable Autokeys - Banking - true if currRef \< minRef AND currKeys \< minKeys
         */
        const isRemoveBankingKeys = currRef <= userMaxRef && currKeys <= userMinKeys;
        /*
        //        <—————●                                         \
        // Keys --------|----------------------------|---------->  ⟩ AND
        //        <——————————————————————————————————●            /
        // Refs --------|----------------------------|---------->
        //             min                          max
        */

        const isAlreadyAlert = this.status.checkAlertOnLowPure;

        /**
         * send alert to admins when both keys and refs below minimum
         */
        const isAlertAdmins = currRef <= userMinRef && currKeys <= userMinKeys;
        /*
        //        <—————●                                         \
        // Keys --------|----------------------------|---------->  ⟩ AND
        //        <—————●                                         /
        // Refs --------|----------------------------|---------->
        //             min                          max
        */

        const isAlreadyUpdatedToBank = this.status.alreadyUpdatedToBank;
        const isAlreadyUpdatedToBuy = this.status.alreadyUpdatedToBuy;
        const isAlreadyUpdatedToSell = this.status.alreadyUpdatedToSell;

        let setMinKeys: number;
        let setMaxKeys: number;
        const roundedAmountKeysCanBuy = Math.round((currRef - userMaxRef) / currKeyPrice.buy.toValue());
        const roundedAmountKeysCanSell = Math.round((userMinRef - currRef) / currKeyPrice.sell.toValue());
        const roundedAmountKeysCanBankMin = Math.round((userMaxRef - currRef) / currKeyPrice.sell.toValue());
        const roundedAmountKeysCanBankMax = Math.round((currRef - userMinRef) / currKeyPrice.buy.toValue());
        const fixedAmountKeysCanBuy = roundedAmountKeysCanBuy === 0 ? 1 : roundedAmountKeysCanBuy;
        const fixedAmountKeysCanSell = roundedAmountKeysCanSell === 0 ? 1 : roundedAmountKeysCanSell;
        const fixedAmountKeysCanBankMin = roundedAmountKeysCanBankMin === 0 ? 1 : roundedAmountKeysCanBankMin;
        const fixedAmountKeysCanBankMax = roundedAmountKeysCanBankMax === 0 ? 1 : roundedAmountKeysCanBankMax;

        // Check and set new min and max
        if ((isBankingBuyKeysWithEnoughRefs && isEnableKeyBanking) || isBuyingKeys) {
            // If buying - we need to set min = currKeys and max = currKeys + amountCanBuy
            setMinKeys = currKeys <= userMinKeys ? userMinKeys : currKeys;
            setMaxKeys =
                currKeys + fixedAmountKeysCanBuy >= userMaxKeys ? userMaxKeys : currKeys + fixedAmountKeysCanBuy;
        } else if (isSellingKeys) {
            // If selling - we need to set min = currKeys - amountCanSell and max = currKeys
            setMinKeys =
                currKeys - fixedAmountKeysCanSell <= userMinKeys ? userMinKeys : currKeys - fixedAmountKeysCanSell;
            setMaxKeys = currKeys >= userMaxKeys ? userMaxKeys : currKeys;
        } else if (isBankingKeys && isEnableKeyBanking) {
            // If banking - we need to set min = currKeys - amountCanBankMin and max = currKeys + amountCanBankMax
            setMinKeys =
                currKeys - fixedAmountKeysCanBankMin <= userMinKeys
                    ? userMinKeys
                    : currKeys - fixedAmountKeysCanBankMin;
            setMaxKeys =
                currKeys + fixedAmountKeysCanBankMax >= userMaxKeys
                    ? userMaxKeys
                    : currKeys + fixedAmountKeysCanBankMax;
        }

        log.debug(
            `Autokeys status:-\n   Ref: minRef(${Currencies.toRefined(userMinRef)})` +
                ` < currRef(${Currencies.toRefined(currRef)})` +
                ` < maxRef(${Currencies.toRefined(userMaxRef)})` +
                `\n   Key: minKeys(${userMinKeys}) ≤ currKeys(${currKeys}) ≤ maxKeys(${userMaxKeys})` +
                `\nStatus: ${
                    isBankingKeys && isEnableKeyBanking
                        ? `Banking (Min: ${setMinKeys}, Max: ${setMaxKeys})`
                        : isBuyingKeys
                        ? `Buying (Min: ${setMinKeys}, Max: ${setMaxKeys})`
                        : isSellingKeys
                        ? `Selling (Min: ${setMinKeys}, Max: ${setMaxKeys})`
                        : 'Not active'
                }`
        );

        const isAlreadyRunningAutokeys = this.isActive;
        const isKeysAlreadyExist = this.bot.pricelist.searchByName('Mann Co. Supply Crate Key', false);
        const time = (this.bot.handler as MyHandler).timeWithEmoji();

        if (isAlreadyRunningAutokeys) {
            // if Autokeys already running
            if (
                isBankingKeys &&
                isEnableKeyBanking &&
                (!isAlreadyUpdatedToBank ||
                    roundedAmountKeysCanBankMin !== this.oldAmount.keysCanBankMin ||
                    roundedAmountKeysCanBankMax !== this.oldAmount.keysCanBankMax ||
                    currKeys !== this.oldAmount.ofKeys)
            ) {
                // enable keys banking - if banking conditions to enable banking matched and banking is enabled
                this.status = {
                    isBuyingKeys: false,
                    isBankingKeys: true,
                    checkAlertOnLowPure: false,
                    alreadyUpdatedToBank: true,
                    alreadyUpdatedToBuy: false,
                    alreadyUpdatedToSell: false
                };
                this.oldAmount = {
                    keysCanSell: 0,
                    keysCanBuy: 0,
                    keysCanBankMin: roundedAmountKeysCanBankMin,
                    keysCanBankMax: roundedAmountKeysCanBankMax,
                    ofKeys: currKeys
                };
                this.isActive = true;
                this.updateAutokeysBanking(setMinKeys, setMaxKeys);
            } else if (
                isBankingBuyKeysWithEnoughRefs &&
                isEnableKeyBanking &&
                (!isAlreadyUpdatedToBuy ||
                    roundedAmountKeysCanBuy !== this.oldAmount.keysCanBuy ||
                    currKeys !== this.oldAmount.ofKeys)
            ) {
                // enable keys banking - if refs > minRefs but Keys < minKeys, will buy keys.
                this.status = {
                    isBuyingKeys: true,
                    isBankingKeys: false,
                    checkAlertOnLowPure: false,
                    alreadyUpdatedToBank: false,
                    alreadyUpdatedToBuy: true,
                    alreadyUpdatedToSell: false
                };
                this.oldAmount = {
                    keysCanSell: 0,
                    keysCanBuy: roundedAmountKeysCanBuy,
                    keysCanBankMin: 0,
                    keysCanBankMax: 0,
                    ofKeys: currKeys
                };
                this.isActive = true;
                this.updateAutokeysBuy(setMinKeys, setMaxKeys);
            } else if (
                isBuyingKeys &&
                (!isAlreadyUpdatedToBuy ||
                    roundedAmountKeysCanBuy !== this.oldAmount.keysCanBuy ||
                    currKeys !== this.oldAmount.ofKeys)
            ) {
                // enable Autokeys - Buying - if buying keys conditions matched
                this.status = {
                    isBuyingKeys: true,
                    isBankingKeys: false,
                    checkAlertOnLowPure: false,
                    alreadyUpdatedToBank: false,
                    alreadyUpdatedToBuy: true,
                    alreadyUpdatedToSell: false
                };
                this.oldAmount = {
                    keysCanSell: 0,
                    keysCanBuy: roundedAmountKeysCanBuy,
                    keysCanBankMin: 0,
                    keysCanBankMax: 0,
                    ofKeys: currKeys
                };
                this.isActive = true;
                this.updateAutokeysBuy(setMinKeys, setMaxKeys);
            } else if (
                isSellingKeys &&
                (!isAlreadyUpdatedToSell ||
                    roundedAmountKeysCanSell !== this.oldAmount.keysCanSell ||
                    currKeys !== this.oldAmount.ofKeys)
            ) {
                // enable Autokeys - Selling - if selling keys conditions matched
                this.status = {
                    isBuyingKeys: false,
                    isBankingKeys: false,
                    checkAlertOnLowPure: false,
                    alreadyUpdatedToBank: false,
                    alreadyUpdatedToBuy: false,
                    alreadyUpdatedToSell: true
                };
                this.oldAmount = {
                    keysCanSell: roundedAmountKeysCanSell,
                    keysCanBuy: 0,
                    keysCanBankMin: 0,
                    keysCanBankMax: 0,
                    ofKeys: currKeys
                };
                this.isActive = true;
                this.updateAutokeysSell(setMinKeys, setMaxKeys);
            } else if (isRemoveBankingKeys && isEnableKeyBanking) {
                // disable keys banking - if to conditions to disable banking matched and banking is enabled
                this.status = {
                    isBuyingKeys: false,
                    isBankingKeys: false,
                    checkAlertOnLowPure: false,
                    alreadyUpdatedToBank: false,
                    alreadyUpdatedToBuy: false,
                    alreadyUpdatedToSell: false
                };
                this.isActive = false;
                this.updateToDisableAutokeys();
            } else if (isRemoveAutoKeys && !isEnableKeyBanking) {
                // disable Autokeys when conditions to disable Autokeys matched
                this.status = {
                    isBuyingKeys: false,
                    isBankingKeys: false,
                    checkAlertOnLowPure: false,
                    alreadyUpdatedToBank: false,
                    alreadyUpdatedToBuy: false,
                    alreadyUpdatedToSell: false
                };
                this.isActive = false;
                this.updateToDisableAutokeys();
            } else if (isAlertAdmins && !isAlreadyAlert) {
                // alert admins when low pure
                this.status = {
                    isBuyingKeys: false,
                    isBankingKeys: false,
                    checkAlertOnLowPure: true,
                    alreadyUpdatedToBank: false,
                    alreadyUpdatedToBuy: false,
                    alreadyUpdatedToSell: false
                };
                this.isActive = false;
                const msg = 'I am now low on both keys and refs.';
                if (process.env.DISABLE_SOMETHING_WRONG_ALERT !== 'true') {
                    if (
                        process.env.DISABLE_DISCORD_WEBHOOK_SOMETHING_WRONG_ALERT === 'false' &&
                        process.env.DISCORD_WEBHOOK_SOMETHING_WRONG_ALERT_URL
                    ) {
                        this.discord.sendLowPureAlert(msg, time.time);
                    } else {
                        this.bot.messageAdmins(msg, []);
                    }
                }
            }
        } else if (!isAlreadyRunningAutokeys) {
            // if Autokeys is not running/disabled
            if (isKeysAlreadyExist === null) {
                // if Mann Co. Supply Crate Key entry does not exist in the pricelist.json
                if (isBankingKeys && isEnableKeyBanking) {
                    //create new Key entry and enable keys banking - if banking conditions to enable banking matched and banking is enabled
                    this.status = {
                        isBuyingKeys: false,
                        isBankingKeys: true,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: true,
                        alreadyUpdatedToBuy: false,
                        alreadyUpdatedToSell: false
                    };
                    this.oldAmount = {
                        keysCanSell: 0,
                        keysCanBuy: 0,
                        keysCanBankMin: roundedAmountKeysCanBankMin,
                        keysCanBankMax: roundedAmountKeysCanBankMax,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.createAutokeysBanking(setMinKeys, setMaxKeys);
                } else if (isBankingBuyKeysWithEnoughRefs && isEnableKeyBanking) {
                    // enable keys banking - if refs > minRefs but Keys < minKeys, will buy keys.
                    this.status = {
                        isBuyingKeys: true,
                        isBankingKeys: false,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: true,
                        alreadyUpdatedToSell: false
                    };
                    this.oldAmount = {
                        keysCanSell: 0,
                        keysCanBuy: roundedAmountKeysCanBuy,
                        keysCanBankMin: 0,
                        keysCanBankMax: 0,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.createAutokeysBuy(setMinKeys, setMaxKeys);
                } else if (isBuyingKeys) {
                    // create new Key entry and enable Autokeys - Buying - if buying keys conditions matched
                    this.status = {
                        isBuyingKeys: true,
                        isBankingKeys: false,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: true,
                        alreadyUpdatedToSell: false
                    };
                    this.oldAmount = {
                        keysCanSell: 0,
                        keysCanBuy: roundedAmountKeysCanBuy,
                        keysCanBankMin: 0,
                        keysCanBankMax: 0,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.createAutokeysBuy(setMinKeys, setMaxKeys);
                } else if (isSellingKeys) {
                    // create new Key entry and enable Autokeys - Selling - if selling keys conditions matched
                    this.status = {
                        isBuyingKeys: false,
                        isBankingKeys: false,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: false,
                        alreadyUpdatedToSell: true
                    };
                    this.oldAmount = {
                        keysCanSell: roundedAmountKeysCanSell,
                        keysCanBuy: 0,
                        keysCanBankMin: 0,
                        keysCanBankMax: 0,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.createAutokeysSell(setMinKeys, setMaxKeys);
                } else if (isAlertAdmins && !isAlreadyAlert) {
                    // alert admins when low pure
                    this.status = {
                        isBuyingKeys: false,
                        isBankingKeys: false,
                        checkAlertOnLowPure: true,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: false,
                        alreadyUpdatedToSell: false
                    };
                    this.isActive = false;
                    const msg = 'I am now low on both keys and refs.';
                    if (process.env.DISABLE_SOMETHING_WRONG_ALERT !== 'true') {
                        if (
                            process.env.DISABLE_DISCORD_WEBHOOK_SOMETHING_WRONG_ALERT === 'false' &&
                            process.env.DISCORD_WEBHOOK_SOMETHING_WRONG_ALERT_URL
                        ) {
                            this.discord.sendLowPureAlert(msg, time.time);
                        } else {
                            this.bot.messageAdmins(msg, []);
                        }
                    }
                }
            } else {
                // if Mann Co. Supply Crate Key entry already in the pricelist.json
                if (
                    isBankingKeys &&
                    isEnableKeyBanking &&
                    (!isAlreadyUpdatedToBank ||
                        roundedAmountKeysCanBankMin !== this.oldAmount.keysCanBankMin ||
                        roundedAmountKeysCanBankMax !== this.oldAmount.keysCanBankMax ||
                        currKeys !== this.oldAmount.ofKeys)
                ) {
                    // enable keys banking - if banking conditions to enable banking matched and banking is enabled
                    this.status = {
                        isBuyingKeys: false,
                        isBankingKeys: true,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: true,
                        alreadyUpdatedToBuy: false,
                        alreadyUpdatedToSell: false
                    };
                    this.oldAmount = {
                        keysCanSell: 0,
                        keysCanBuy: 0,
                        keysCanBankMin: roundedAmountKeysCanBankMin,
                        keysCanBankMax: roundedAmountKeysCanBankMax,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.updateAutokeysBanking(setMinKeys, setMaxKeys);
                } else if (
                    isBankingBuyKeysWithEnoughRefs &&
                    isEnableKeyBanking &&
                    (!isAlreadyUpdatedToBuy ||
                        roundedAmountKeysCanBuy !== this.oldAmount.keysCanBuy ||
                        currKeys !== this.oldAmount.ofKeys)
                ) {
                    // enable keys banking - if refs > minRefs but Keys < minKeys, will buy keys.
                    this.status = {
                        isBuyingKeys: true,
                        isBankingKeys: false,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: true,
                        alreadyUpdatedToSell: false
                    };
                    this.oldAmount = {
                        keysCanSell: 0,
                        keysCanBuy: roundedAmountKeysCanBuy,
                        keysCanBankMin: 0,
                        keysCanBankMax: 0,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.updateAutokeysBuy(setMinKeys, setMaxKeys);
                } else if (
                    isBuyingKeys &&
                    (!isAlreadyUpdatedToBuy ||
                        roundedAmountKeysCanBuy !== this.oldAmount.keysCanBuy ||
                        currKeys !== this.oldAmount.ofKeys)
                ) {
                    // enable Autokeys - Buying - if buying keys conditions matched
                    this.status = {
                        isBuyingKeys: true,
                        isBankingKeys: false,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: true,
                        alreadyUpdatedToSell: false
                    };
                    this.oldAmount = {
                        keysCanSell: 0,
                        keysCanBuy: roundedAmountKeysCanBuy,
                        keysCanBankMin: 0,
                        keysCanBankMax: 0,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.updateAutokeysBuy(setMinKeys, setMaxKeys);
                } else if (
                    isSellingKeys &&
                    (!isAlreadyUpdatedToSell ||
                        roundedAmountKeysCanSell !== this.oldAmount.keysCanSell ||
                        currKeys !== this.oldAmount.ofKeys)
                ) {
                    // enable Autokeys - Selling - if selling keys conditions matched
                    this.status = {
                        isBuyingKeys: false,
                        isBankingKeys: false,
                        checkAlertOnLowPure: false,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: false,
                        alreadyUpdatedToSell: true
                    };
                    this.oldAmount = {
                        keysCanSell: roundedAmountKeysCanSell,
                        keysCanBuy: 0,
                        keysCanBankMin: 0,
                        keysCanBankMax: 0,
                        ofKeys: currKeys
                    };
                    this.isActive = true;
                    this.updateAutokeysSell(setMinKeys, setMaxKeys);
                } else if (isAlertAdmins && !isAlreadyAlert) {
                    // alert admins when low pure
                    this.status = {
                        isBuyingKeys: false,
                        isBankingKeys: false,
                        checkAlertOnLowPure: true,
                        alreadyUpdatedToBank: false,
                        alreadyUpdatedToBuy: false,
                        alreadyUpdatedToSell: false
                    };
                    this.isActive = false;
                    const msg = 'I am now low on both keys and refs.';
                    if (process.env.DISABLE_SOMETHING_WRONG_ALERT !== 'true') {
                        if (
                            process.env.DISABLE_DISCORD_WEBHOOK_SOMETHING_WRONG_ALERT === 'false' &&
                            process.env.DISCORD_WEBHOOK_SOMETHING_WRONG_ALERT_URL
                        ) {
                            this.discord.sendLowPureAlert(msg, time.time);
                        } else {
                            this.bot.messageAdmins(msg, []);
                        }
                    }
                }
            }
        }
        this.bot.listings.checkBySKU('5021;6');
    }

    private createAutokeysSell(minKeys: number, maxKeys: number): void {
        const keyPrices = this.bot.pricelist.getKeyPrices();
        let entry;
        if (!this.isEnableScrapAdjustment) {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: true,
                min: minKeys,
                max: maxKeys,
                intent: 1
            } as any;
        } else {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: false,
                sell: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.sell.toValue() - this.scrapAdjustmentValue)
                },
                buy: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.buy.toValue() - this.scrapAdjustmentValue)
                },
                min: minKeys,
                max: maxKeys,
                intent: 1
            } as any;
        }
        this.bot.pricelist
            .addPrice(entry as EntryData, false)
            .then(data => {
                log.debug(`✅ Automatically added Mann Co. Supply Crate Key to sell.`);
                this.bot.listings.checkBySKU(data.sku, data);
            })
            .catch(err => {
                log.warn(`❌ Failed to add Mann Co. Supply Crate Key to sell automatically: ${err.message}`);
                this.isActive = false;
            });
    }

    private createAutokeysBuy(minKeys: number, maxKeys: number): void {
        const keyPrices = this.bot.pricelist.getKeyPrices();
        let entry;
        if (!this.isEnableScrapAdjustment) {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: true,
                min: minKeys,
                max: maxKeys,
                intent: 0
            } as any;
        } else {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: false,
                sell: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.sell.toValue() + this.scrapAdjustmentValue)
                },
                buy: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.buy.toValue() + this.scrapAdjustmentValue)
                },
                min: minKeys,
                max: maxKeys,
                intent: 0
            } as any;
        }
        this.bot.pricelist
            .addPrice(entry as EntryData, false)
            .then(data => {
                log.debug(`✅ Automatically added Mann Co. Supply Crate Key to buy.`);
                this.bot.listings.checkBySKU(data.sku, data);
            })
            .catch(err => {
                log.warn(`❌ Failed to add Mann Co. Supply Crate Key to buy automatically: ${err.message}`);
                this.isActive = false;
            });
    }

    private createAutokeysBanking(minKeys: number, maxKeys: number): void {
        const entry = {
            sku: '5021;6',
            enabled: true,
            autoprice: true,
            min: minKeys,
            max: maxKeys,
            intent: 2
        } as any;
        this.bot.pricelist
            .addPrice(entry as EntryData, false)
            .then(data => {
                log.debug(`✅ Automatically added Mann Co. Supply Crate Key to bank.`);
                this.bot.listings.checkBySKU(data.sku, data);
            })
            .catch(err => {
                log.warn(`❌ Failed to add Mann Co. Supply Crate Key to bank automatically: ${err.message}`);
                this.isActive = false;
            });
    }

    updateToDisableAutokeys(): void {
        const entry = {
            sku: '5021;6',
            enabled: false,
            autoprice: true,
            min: 0,
            max: 1,
            intent: 1
        } as any;
        this.bot.pricelist
            .updatePrice(entry as EntryData, false)
            .then(data => {
                log.debug(`✅ Automatically disabled Autokeys.`);
                this.bot.listings.checkBySKU(data.sku, data);
            })
            .catch(err => {
                log.warn(`❌ Failed to disable Autokeys: ${err.message}`);
                this.isActive = true;
            });
    }

    private updateAutokeysSell(minKeys: number, maxKeys: number): void {
        const keyPrices = this.bot.pricelist.getKeyPrices();
        let entry;
        if (!this.isEnableScrapAdjustment) {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: true,
                min: minKeys,
                max: maxKeys,
                intent: 1
            } as any;
        } else {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: false,
                sell: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.sell.toValue() - this.scrapAdjustmentValue)
                },
                buy: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.buy.toValue() - this.scrapAdjustmentValue)
                },
                min: minKeys,
                max: maxKeys,
                intent: 1
            } as any;
        }
        this.bot.pricelist
            .updatePrice(entry as EntryData, false)
            .then(data => {
                log.debug(`✅ Automatically updated Mann Co. Supply Crate Key to sell.`);
                this.bot.listings.checkBySKU(data.sku, data);
            })
            .catch(err => {
                log.warn(`❌ Failed to update Mann Co. Supply Crate Key to sell automatically: ${err.message}`);
                this.isActive = false;
            });
    }

    private updateAutokeysBuy(minKeys: number, maxKeys: number): void {
        const keyPrices = this.bot.pricelist.getKeyPrices();
        let entry;
        if (!this.isEnableScrapAdjustment) {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: true,
                min: minKeys,
                max: maxKeys,
                intent: 0
            } as any;
        } else {
            entry = {
                sku: '5021;6',
                enabled: true,
                autoprice: false,
                sell: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.sell.toValue() + this.scrapAdjustmentValue)
                },
                buy: {
                    keys: 0,
                    metal: Currencies.toRefined(keyPrices.buy.toValue() + this.scrapAdjustmentValue)
                },
                min: minKeys,
                max: maxKeys,
                intent: 0
            } as any;
        }
        this.bot.pricelist
            .updatePrice(entry as EntryData, false)
            .then(data => {
                log.debug(`✅ Automatically update Mann Co. Supply Crate Key to buy.`);
                this.bot.listings.checkBySKU(data.sku, data);
            })
            .catch(err => {
                log.warn(`❌ Failed to update Mann Co. Supply Crate Key to buy automatically: ${err.message}`);
                this.isActive = false;
            });
    }

    private updateAutokeysBanking(minKeys: number, maxKeys: number): void {
        const entry = {
            sku: '5021;6',
            enabled: true,
            autoprice: true,
            min: minKeys,
            max: maxKeys,
            intent: 2
        } as any;
        this.bot.pricelist
            .updatePrice(entry as EntryData, false)
            .then(data => {
                log.debug(`✅ Automatically updated Mann Co. Supply Crate Key to bank.`);
                this.bot.listings.checkBySKU(data.sku, data);
            })
            .catch(err => {
                log.warn(`❌ Failed to update Mann Co. Supply Crate Key to bank automatically: ${err.message}`);
                this.isActive = false;
            });
    }

    private removeAutoKeys(): void {
        this.bot.pricelist
            .removePrice('5021;6', false)
            .then(() => {
                log.debug(`✅ Automatically remove Mann Co. Supply Crate Key.`);
                this.bot.listings.checkBySKU('5021;6');
            })
            .catch(err => {
                log.warn(`❌ Failed to remove Mann Co. Supply Crate Key automatically: ${err.message}`);
                this.isActive = true;
            });
    }

    refreshAutokeys(): void {
        this.removeAutoKeys();
        this.status = {
            isBuyingKeys: false,
            isBankingKeys: false,
            checkAlertOnLowPure: false,
            alreadyUpdatedToBank: false,
            alreadyUpdatedToBuy: false,
            alreadyUpdatedToSell: false
        };
        this.isActive = false;
        this.sleep(2 * 1000);
        this.check();
    }

    private sleep(mili: number): void {
        const date = moment().valueOf();
        let currentDate = null;
        do {
            currentDate = moment().valueOf();
        } while (currentDate - date < mili);
    }
}
